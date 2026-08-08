/**
 * Photo treatment — an OPT-IN per-image control (grayscale / duotone /
 * grain). Absent/`'none'` is the default; nothing sets it automatically —
 * not generate, not shuffle, not surprise. It rides the element like any
 * other `style` field, so a re-roll that regenerates a staging-origin
 * element loses it (same as any other hand-set style), while a freeform
 * element carries it through byte-identical.
 *
 * Render-path split (see docs/superpowers/sdd/slgen2a-task-11-report.md for
 * the GATE probe evidence this is built on):
 *  - satori (server) + the browser (editor) both honour a plain CSS `filter`
 *    on an <img> — confirmed by rendering a real satori→resvg PNG with and
 *    without `filter: grayscale(1)` and diffing pixels. So 'grayscale' is
 *    expressed as a CSS filter string in BOTH renderers, from ONE mapping
 *    here (`treatmentCssFilter`) — they can't drift.
 *  - 'duotone' is NOT expressible as a faithful CSS filter (grayscale+sepia
 *    hacks shift hue, they don't map luminance onto a real two-colour ramp),
 *    so it always bakes into the image bytes server-side (sharp, at
 *    image-inline time — see server/templates/inlineImages.ts) regardless of
 *    the grayscale verdict. The editor shows a grayscale + ink-tint overlay
 *    as its live approximation (`editorImgFilter` + `treatmentOverlay`).
 *  - 'grain' is a per-pixel noise pass, also baked server-side; the editor
 *    approximates it with a tiled noise-texture overlay, not a filter.
 */

export type TreatmentKind = 'none' | 'grayscale' | 'duotone' | 'grain'

export interface PhotoTreatment {
  kind: TreatmentKind
  /** 0–1 strength. Meaning depends on kind: filter amount (grayscale), tint
   *  blend (duotone), or noise opacity (grain). Defaults to 1 when absent. */
  intensity?: number
}

/** Clamped 0–1 intensity, defaulting to 1 (full strength) when unset. */
export function treatmentIntensity(t?: PhotoTreatment): number {
  const n = t?.intensity
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1
}

/** True when a treatment is actually set (kind present and not 'none'). */
export function hasTreatment(t?: PhotoTreatment): boolean {
  return Boolean(t && t.kind !== 'none')
}

/** CSS `filter` string for the ONE kind satori/resvg render faithfully as a
 *  real CSS filter (grayscale — confirmed by the render-path GATE probe).
 *  Returns undefined for 'none', absent treatments, and 'duotone'/'grain'
 *  (those bake into the image server-side instead — see `needsServerBake`).
 *  The single source both renderers (server/templates/translate.ts and the
 *  editor's GridEditorCanvas.vue) call, so the mapping can't drift. */
export function treatmentCssFilter(t?: PhotoTreatment): string | undefined {
  if (!hasTreatment(t) || t!.kind !== 'grayscale') return undefined
  return `grayscale(${treatmentIntensity(t)})`
}

/** Kinds that must be baked into the image bytes server-side (sharp) at
 *  image-inline time, rather than expressed as a satori CSS filter. */
export function needsServerBake(t?: PhotoTreatment): boolean {
  return hasTreatment(t) && (t!.kind === 'duotone' || t!.kind === 'grain')
}

/** Editor-only LIVE approximation of the img `filter` for kinds that only
 *  render faithfully via the server bake. 'duotone' previews as flat
 *  grayscale (the real ink tint comes from `treatmentOverlay`'s blend
 *  layer, not a filter function); 'grain' has no filter approximation — the
 *  editor overlays a noise texture instead (see `treatmentOverlay`). */
export function editorImgFilter(t?: PhotoTreatment): string | undefined {
  if (!hasTreatment(t)) return undefined
  if (t!.kind === 'grayscale') return treatmentCssFilter(t)
  if (t!.kind === 'duotone') return 'grayscale(1)'
  return undefined
}

export interface TreatmentOverlay {
  kind: 'duotone' | 'grain'
  style: Record<string, string | number>
}

/** Editor-only live overlay for kinds a filter alone can't approximate: an
 *  ink-tinted blend layer for duotone, a tiled noise texture for grain.
 *  `ink` is the resolved theme ink colour (callers pass effectiveBrand's
 *  foreground). Returns null when no overlay applies (kind 'none'/absent,
 *  or 'grayscale' — that one is filter-only, no overlay needed). */
export function treatmentOverlay(t: PhotoTreatment | undefined, ink: string): TreatmentOverlay | null {
  if (!hasTreatment(t)) return null
  const intensity = treatmentIntensity(t)
  if (t!.kind === 'duotone') {
    return {
      kind: 'duotone',
      style: {
        position: 'absolute', inset: '0',
        background: ink,
        mixBlendMode: 'color',
        opacity: intensity,
        pointerEvents: 'none',
      },
    }
  }
  if (t!.kind === 'grain') {
    // Inline SVG fractal-noise texture — no asset file, tiles at a fixed
    // px size regardless of the element's box.
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'>"
      + "<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>"
      + "<rect width='100%' height='100%' filter='url(%23n)'/></svg>"
    return {
      kind: 'grain',
      style: {
        position: 'absolute', inset: '0',
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        backgroundSize: '160px 160px',
        opacity: intensity * 0.5,
        mixBlendMode: 'overlay',
        pointerEvents: 'none',
      },
    }
  }
  return null
}

/** Payload tag stamped on a satori `<img>` node's props by translate.ts when
 *  `needsServerBake` is true — read (and stripped) by
 *  server/templates/inlineImages.ts to bake the treatment into the actual
 *  image bytes before satori ever sees the node. Never reaches satori. */
export interface TreatmentBakeTag {
  kind: 'duotone' | 'grain'
  intensity: number
  /** Resolved (already-tokens-substituted) hex ink colour. */
  ink: string
}
