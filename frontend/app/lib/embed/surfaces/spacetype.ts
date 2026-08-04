import type { EmbedSurface, EmbedHandle } from '../contract'
import { fontFaceRule, fontFaceId } from '../fontFace'
import { SpaceTypeEngine, type EngineOptions } from '~/lib/spacetype/engine'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects/index'
import type { SpaceTypeEffect, Params } from '~/lib/spacetype/effect'
import type { TextTextureOptions } from '~/lib/spacetype/textTexture'
import { buildRibbonLabel } from '~/lib/spacetype/ribbonMath'

/**
 * Space Type is the first embed surface that draws TEXT and the first with
 * genuine transparency. Both properties shape this file:
 *
 *  - The font must be present in the DOCUMENT before the first render — canvas
 *    text falls back to sans-serif silently, not with an error, if the family
 *    named in `font` / `params.font` is not yet loaded. mount() is async
 *    exactly so this asset inflation can happen once, up front (see the font
 *    block below).
 *  - `caps.alpha: true` is genuine here (measured — see below), unlike
 *    shader/gradient which both declared `false` because they never produce
 *    a transparent pixel.
 */
export interface SpaceTypeEmbedConfig {
  effectId: string
  params: Params
  opts: Omit<EngineOptions, 'effect'>
  /** Loop length in seconds. Present for parity with EmbedSnapshot.duration and the
   *  other two embed configs, but UNUSED here: engine.renderFrameAt takes t01
   *  directly (already normalized, already synchronous — see engine.ts's docstring),
   *  unlike GradientFxRenderer.render/composePasses which want seconds. */
  duration: number
  /** Pre-resolved custom font to inject, or null to use whatever family
   *  `params.font` names as-is (e.g. a generic/system family already present
   *  in the viewer's browser — nothing to inject or await). */
  font: { family: string; weight: number; dataUrl: string } | null
}

// Effects whose glyphs size to their own (uppercased or as-typed) word with NO
// trailing-gap pad, rather than the tiled-ribbon label. Mirrors RAW_WORD_EFFECTS
// in ~/lib/spacetype/state.ts — duplicated (not imported) because state.ts pulls
// in ~/data/google-fonts.ts for its own font-family resolution, which this
// adapter deliberately does NOT want (see buildTexOpts below).
const RAW_WORD_EFFECTS = new Set(['coil', 'elastic', 'echo'])

/**
 * Text-texture options for one embed frame. Mirrors texOptsFromState in
 * ~/lib/spacetype/state.ts (the studio's own builder) for every field EXCEPT:
 *
 *  - fontFamily/fontWeight come from the embed's pre-resolved `font` (or,
 *    when `font` is null, straight from params) rather than
 *    resolveFontFamily/fontHasWeightAxis — those consult the live Google
 *    Fonts catalog (~/data/google-fonts.ts's `fetch('/api/google-fonts')`),
 *    which is exactly the kind of network dependency an embed must never
 *    carry. The export pipeline resolves the real family/weight once, at
 *    export time, and hands it to us pre-resolved.
 *  - gradientStops is always empty/off: SpaceTypeState.gradientStops is a
 *    top-level field the export pipeline does not fold into
 *    SpaceTypeEmbedConfig (see this task's report) — gradient-across-text
 *    is out of scope for this adapter's v1.
 */
function buildTexOpts(
  effect: SpaceTypeEffect,
  params: Params,
  font: { family: string; weight: number } | null,
): TextTextureOptions {
  const family = font?.family ?? String(params.font ?? 'Inter')
  const weight = font?.weight ?? Number(params.typeWeight ?? 700)
  const multiAware = effect.controls.some(c => c.kind === 'textList')
  const rawTexts = String(params.text ?? '').split('\n').map(t => t.trim()).filter(Boolean)
  const texts = rawTexts.length ? rawTexts : ['']
  const rawWords = RAW_WORD_EFFECTS.has(effect.id)
  const asis = String(params.textCase ?? 'upper') === 'asis'
  const caseMode = asis ? 'as-typed' as const : 'upper' as const
  const cased = (t: string) => (asis ? t : t.toUpperCase())
  const labels = multiAware
    ? texts.map(t => (rawWords ? cased(t) : buildRibbonLabel(t, caseMode)))
    : [rawWords ? cased(texts[0] ?? '') : buildRibbonLabel(texts[0] ?? '', caseMode)]
  // Supersample the text atlas — see texOptsFromState's identical comment.
  const cpSS = texts.length <= 2 ? 5 : texts.length === 3 ? 4 : texts.length <= 5 ? 3 : 2
  const atlasSS = effect.id === 'cornerpin' ? cpSS : effect.id === 'slitscan' ? 3 : 2
  return {
    label: labels[0]!,
    labels,
    fontFamily: family,
    fontWeight: weight,
    axes: { wght: weight },
    typeColor: String(params.typeColor),
    fontSizePx: Number(params.typeYScale ?? params.typeHeight ?? 180) * atlasSS,
    heightPx: 256 * atlasSS,
    scaleX: Number(params.typeXScale ?? 1),
    tracking: Number(params.tracking),
    strokeColor: '#000000',
    strokeWidth: Number(params.typeStroke),
    gradientStops: [],
    gradientOn: false,
    uRepeat: Number(params.textRepeat),
  }
}

const spaceTypeEmbedSurface: EmbedSurface = {
  kind: 'spacetype',
  // Measured, not assumed (mirrors the discipline in gradient.ts/shader.ts): the
  // renderer in engine.ts is ALWAYS constructed with `alpha: true`
  // (`new THREE.WebGLRenderer({ canvas, alpha: true, ... })`), and
  // applyBackground() — run on construction and again from setBackground() —
  // sets `scene.background = null` and clears to (0,0,0,0) whenever
  // `opts.alpha` is true, rather than hardcoding an opaque clear the way
  // GradientFxRenderer/ShaderFxRenderer's pipelines do. So when a config's
  // opts.alpha is true, the canvas Space Type hands back genuinely carries a
  // transparent background through to its pixels.
  caps: { alpha: true },

  async mount(container: HTMLElement, config: unknown): Promise<EmbedHandle> {
    const cfg = config as SpaceTypeEmbedConfig
    if (!cfg?.effectId) throw new Error('space type embed: config has no effectId')
    if (!cfg.opts) throw new Error('space type embed: config has no opts')

    // Throw on an unknown effectId rather than falling back to a default
    // effect (unlike getEffect() in effects/index.ts, which is deliberately
    // lenient for the live studio). A silently substituted effect renders
    // something plausible-looking that is simply the wrong export — worse
    // than a failed one, because nothing signals it happened.
    const lower = String(cfg.effectId).toLowerCase()
    const effect = SPACE_TYPE_EFFECTS.find(e => e.id.toLowerCase() === lower)
    if (!effect) {
      throw new Error(`space type embed: unknown effectId "${cfg.effectId}"`)
    }

    // Inject and await the font BEFORE the first render. Skipped only when
    // `font` is explicitly null (params.font already names a family the
    // viewer's browser provides natively). Never wrapped in try/catch here —
    // a failed font load must reject mount(), not render confidently in the
    // wrong typeface with no visible sign anything went wrong.
    if (cfg.font) {
      const { family, weight, dataUrl } = cfg.font
      const id = fontFaceId(family, weight)
      if (!document.head.querySelector(`style[data-sailor-embed-font="${id}"]`)) {
        const styleEl = document.createElement('style')
        styleEl.setAttribute('data-sailor-embed-font', id)
        styleEl.textContent = fontFaceRule({ family, weight, dataUrl })
        document.head.appendChild(styleEl)
      }
      await document.fonts.load(`${weight} 16px "${family}"`)
      await document.fonts.ready
    }

    // Own canvas + own engine instance, not a pooled/shared one — two Space
    // Type embeds on one page must not share a GL context (mirrors the
    // gradient/shader adapters' identical guard). Per-effect state lives on
    // root.userData (see engine.ts's build()), which is what makes two
    // concurrent engines safe.
    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    const engine = new SpaceTypeEngine(canvas, { ...cfg.opts, effect })

    const texOpts = buildTexOpts(effect, cfg.params, cfg.font)
    engine.build(cfg.params, texOpts)

    container.appendChild(canvas)
    // Draw once at mount so the container is never empty before the first tick.
    engine.renderFrameAt(0, cfg.params)

    return {
      // renderFrameAt already takes normalized t01 and is synchronous — no
      // conversion, unlike the gradient/shader adapters' `t01 * duration`.
      setTime: (t01: number) => engine.renderFrameAt(t01, cfg.params),
      setSize: (nw: number, nh: number) => {
        engine.setSize(Math.max(1, Math.round(nw)), Math.max(1, Math.round(nh)))
      },
      destroy: () => {
        canvas.remove()
        // Frees GPU resources AND force-loses the WebGL context (see
        // engine.dispose()'s doc) — browsers cap live contexts at ~16.
        engine.dispose()
      },
    }
  },
}

export default spaceTypeEmbedSurface
