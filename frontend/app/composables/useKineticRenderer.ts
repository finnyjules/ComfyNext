/**
 * useKineticRenderer — the engine for the Kinetic Typography node.
 *
 * Two modes:
 *   1. **Preview**: builds a GSAP timeline on real DOM elements (SplitText spans)
 *      and plays it. The widget shows this live.
 *   2. **Bake**: seeks the same timeline frame-by-frame, reads each char's
 *      computed transform, and renders to Canvas2D → PNG batch → upload.
 *
 * Font handling reuses the Font Playground's infrastructure: the same Google
 * Fonts CSS injection, the same `fontVariationSettings` on the canvas context,
 * the same `applyCtxFont`-style pipeline.
 */

import { ref, type Ref } from 'vue'
import { gsap, SplitText } from '~/lib/gsap-kinetic'
import {
  KINETIC_PRESETS_BY_ID,
  DEFAULT_KINETIC_PRESET_ID,
  DEFAULT_KINETIC_OPTS,
  type KineticOpts,
  type KineticBuildContext,
} from '~/data/kinetic-presets'
import { interpolateAxes, axesToVariationSettings, type AxisKeyframe } from '~/lib/motion/axes'
import { uploadFrameBatch } from '~/lib/studio/frameUpload'

// Re-exported so existing importers (KineticTypeModal, AxisKeyframeEditor,
// WidgetKineticType) keep resolving AxisKeyframe from this module. The
// canonical home is now ~/lib/motion/axes.
export type { AxisKeyframe } from '~/lib/motion/axes'

// ── Types ───────────────────────────────────────────────────────────────────

export interface KineticFontState {
  family: string
  cssUrl: string
  weight: number
  variationSettings: string  // e.g. '"wght" 700, "wdth" 100'
  /** Letter-spacing in em. */
  letterSpacing: number
  /** Font size in px at the bake's reference resolution. */
  sizePx: number
  color: string
  bgColor: string   // 'transparent' or hex
}

export interface KineticState {
  text: string
  font: KineticFontState
  presetId: string
  opts: KineticOpts
  fps: number
  duration: number   // seconds — the clip length
  /** Optional axis keyframes for variable-font animation. When present,
   *  fontVariationSettings are interpolated per-frame during bake. */
  axisKeyframes?: AxisKeyframe[]
}

// The bake reads each char's live computed transform/opacity from the
// on-screen DOM (renderFrameFromDom) — no intermediate snapshot struct.

// Axis keyframe interpolation (interpolateAxes / axesToVariationSettings) and
// the AxisKeyframe type now live in ~/lib/motion/axes — imported above.

// ── Font loading (shared with Font Playground) ──────────────────────────────

const loadedFonts = new Set<string>()

function ensureFontLink(cssUrl: string) {
  if (typeof document === 'undefined' || loadedFonts.has(cssUrl)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cssUrl
  link.dataset.kineticFont = ''
  document.head.appendChild(link)
  loadedFonts.add(cssUrl)
}

async function waitFontReady(family: string, weight: number): Promise<void> {
  if (typeof document === 'undefined') return
  const spec = `${weight} 64px "${family}"`
  try {
    await Promise.race([
      document.fonts.load(spec).then(() => document.fonts.ready),
      new Promise<void>(r => setTimeout(r, 3000)),
    ])
  } catch { /* proceed with whatever's available */ }
}

// ── Preview (DOM-based animation) ───────────────────────────────────────────

export interface PreviewHandle {
  /** The GSAP timeline — call play/pause/restart/seek on it. */
  timeline: gsap.core.Timeline
  /** SplitText instance — call revert() to undo the DOM split. */
  split: InstanceType<typeof SplitText>
  /** Destroy the preview (reverts SplitText, kills timeline). */
  destroy: () => void
}

/**
 * Build a live GSAP preview on a DOM container. The container should hold
 * the text content already styled with the right font. SplitText splits it,
 * the preset builds the timeline, and we return handles for playback control.
 */
export function buildPreview(
  container: HTMLElement,
  presetId: string,
  opts: KineticOpts,
  /** Force the timeline to loop regardless of preset category. Useful for gallery card previews. */
  forceLoop = false,
): PreviewHandle {
  const preset = KINETIC_PRESETS_BY_ID[presetId] ?? KINETIC_PRESETS_BY_ID[DEFAULT_KINETIC_PRESET_ID]!

  // SplitText decomposes the container's text content into nested spans.
  const split = new SplitText(container, {
    type: 'chars,words,lines',
  })

  const shouldLoop = forceLoop || preset.category === 'loop'
  const tl = gsap.timeline({
    paused: true,
    repeat: shouldLoop ? -1 : 0,
    repeatDelay: shouldLoop ? 0.6 : 0,  // brief pause between loops so the motion reads clearly
  })

  const ctx: KineticBuildContext = {
    tl,
    chars: split.chars as HTMLElement[],
    words: split.words as HTMLElement[],
    lines: split.lines as HTMLElement[],
    container,
    opts,
  }

  preset.build?.(ctx)

  return {
    timeline: tl,
    split,
    destroy() {
      tl.kill()
      split.revert()
    },
  }
}

// ── Bake (Canvas2D frame sequence) ──────────────────────────────────────────

const BAKE_SCALE = 2      // render at 2× for crisp output
const BAKE_PAD = 0.3       // padding as fraction of font size

/** Accumulate an element's layout offset relative to an ancestor, walking the
 *  offsetParent chain. offsetLeft/offsetTop are NOT affected by CSS transforms,
 *  so this gives the *natural* (pre-transform) layout position — stable across
 *  animation frames. Handles SplitText's nested char/word/line structure. */
function layoutOffset(el: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0
  let node: HTMLElement | null = el
  while (node && node !== ancestor) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y }
}

/** Per-char natural geometry, measured once before the animation runs. */
interface CharGeom {
  el: HTMLElement
  ch: string
  cx: number       // natural center X relative to stage
  cy: number       // natural center Y relative to stage
  w: number
  h: number
  lx: number       // natural top-left X
  ly: number       // natural top-left Y
}

/** Measure every char's natural layout box relative to the stage. Call once
 *  while the chars are at rest (no GSAP transform applied yet). */
function measureCharGeom(chars: HTMLElement[], stage: HTMLElement): CharGeom[] {
  return chars.map(el => {
    const off = layoutOffset(el, stage)
    const w = el.offsetWidth
    const h = el.offsetHeight
    return {
      el, ch: el.textContent || '',
      lx: off.x, ly: off.y,
      w, h,
      cx: off.x + w / 2,
      cy: off.y + h / 2,
    }
  })
}

/** Parse a transform-origin component ("12px" or "50%") to px given the box size. */
function parseOriginPart(part: string, size: number): number {
  if (part.endsWith('%')) return (parseFloat(part) / 100) * size
  return parseFloat(part) || 0
}

/**
 * Render one frame to canvas by replicating each char's *live, computed* CSS
 * transform exactly — the same rendering the on-screen preview shows.
 *
 * CSS applies a transform around its transform-origin as:
 *   visual = T(origin) · matrix · T(-origin)
 * We reproduce that on the canvas context per char, so rotation/scale with
 * non-center origins (swing, roll) render correctly too.
 */
function renderFrameFromDom(
  geom: CharGeom[],
  font: KineticFontState,
  containerW: number,
  containerH: number,
  scale: number,
  variationOverride?: string,
): HTMLCanvasElement {
  const fontPx = font.sizePx * scale
  const canvasW = Math.max(2, Math.ceil(containerW * scale))
  const canvasH = Math.max(2, Math.ceil(containerH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = canvasW
  canvas.height = canvasH
  const rctx = canvas.getContext('2d')!

  if (font.bgColor !== 'transparent') {
    rctx.fillStyle = font.bgColor
    rctx.fillRect(0, 0, canvasW, canvasH)
  }

  for (const g of geom) {
    if (!g.ch.trim()) continue

    const cs = getComputedStyle(g.el)
    const opacity = parseFloat(cs.opacity)
    if (!isFinite(opacity) || opacity <= 0.001) continue

    // Transform matrix (or identity)
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0
    const tm = cs.transform
    if (tm && tm !== 'none') {
      const m = new DOMMatrixReadOnly(tm)
      a = m.a; b = m.b; c = m.c; d = m.d; e = m.e; f = m.f
    }

    // Transform origin in stage coords
    const originParts = (cs.transformOrigin || '50% 50%').split(' ')
    const ox = g.lx + parseOriginPart(originParts[0] ?? '50%', g.w)
    const oy = g.ly + parseOriginPart(originParts[1] ?? '50%', g.h)

    // Blur
    let blurPx = 0
    const blurMatch = cs.filter?.match(/blur\(([0-9.]+)px\)/)
    if (blurMatch) blurPx = parseFloat(blurMatch[1])

    const color = cs.color || font.color

    rctx.save()
    rctx.globalAlpha = Math.max(0, Math.min(1, opacity))
    if (blurPx > 0) rctx.filter = `blur(${blurPx * scale}px)`

    // Replicate CSS: T(origin) · M · T(-origin), all in scaled canvas coords.
    rctx.translate(ox * scale, oy * scale)
    rctx.transform(a, b, c, d, e * scale, f * scale)
    rctx.translate(-ox * scale, -oy * scale)

    rctx.font = `${font.weight} ${fontPx}px "${font.family}", sans-serif`
    if ((rctx as any).fontVariationSettings !== undefined) {
      ;(rctx as any).fontVariationSettings = variationOverride ?? font.variationSettings
    }
    if ((rctx as any).letterSpacing !== undefined) {
      ;(rctx as any).letterSpacing = `${font.letterSpacing * fontPx}px`
    }
    rctx.fillStyle = color
    rctx.textAlign = 'center'
    rctx.textBaseline = 'middle'
    // Draw the glyph at its natural center (scaled)
    rctx.fillText(g.ch, g.cx * scale, g.cy * scale)
    rctx.restore()
  }

  return canvas
}

/**
 * Bake the kinetic animation into a sequence of PNG frames.
 *
 * Creates a hidden DOM container, styles it, runs SplitText + the GSAP
 * preset, then seeks frame-by-frame, snapshots char positions, and
 * renders each frame to Canvas2D.
 *
 * Returns an array of Blob (PNG) — one per frame.
 */
export async function bakeFrames(
  state: KineticState,
  onProgress?: (current: number, total: number) => void,
): Promise<Blob[]> {
  const { text, font, presetId, opts, fps, duration } = state
  if (!text.trim()) return []

  // Ensure font is loaded
  ensureFontLink(font.cssUrl)
  await waitFontReady(font.family, font.weight)

  const totalFrames = Math.max(1, Math.ceil(fps * duration))
  const padPx = font.sizePx * BAKE_PAD

  // ── Build the animated element ON-SCREEN (behind the modal) ────────────
  // This is the key fix: off-screen elements (top:-9999px) don't reliably
  // report layout (offsetLeft/Top) or computed transforms. We render the
  // bake element on-screen at a low z-index — the modal overlay (z-index
  // 9000) covers it, so the user never sees it, but layout + getComputedStyle
  // work exactly like they do for the live preview.
  const stage = document.createElement('div')
  stage.style.cssText = `
    position: fixed; top: 0; left: 0; z-index: 1;
    pointer-events: none; opacity: 0.01;
    padding: ${padPx}px;
    font-family: "${font.family}", sans-serif;
    font-weight: ${font.weight};
    font-variation-settings: ${font.variationSettings};
    font-size: ${font.sizePx}px;
    color: ${font.color};
    letter-spacing: ${font.letterSpacing}em;
    line-height: 1.2;
    white-space: nowrap;
    display: inline-block;
  `
  stage.textContent = text
  document.body.appendChild(stage)

  // Wait two frames so the browser fully lays out the text (fonts applied).
  await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))

  // Container layout size → canvas size (before any transforms are applied)
  const containerW = stage.offsetWidth
  const containerH = stage.offsetHeight

  const preview = buildPreview(stage, presetId, opts)
  const { timeline, split, destroy } = preview
  const splitChars = split.chars as HTMLElement[]

  // Measure each char's natural layout box ONCE. offsetLeft/Top/Width/Height
  // are transform-independent, so these stay valid for every frame even after
  // GSAP applies transforms.
  const geom = measureCharGeom(splitChars, stage)

  // For loop presets, limit to one cycle
  const effectiveDuration = timeline.duration() || duration

  // Parse axis keyframes for variable-font animation
  const axisKfs = state.axisKeyframes ?? []
  const staticAxes: Record<string, number> = {}
  for (const part of font.variationSettings.split(',')) {
    const m = part.trim().match(/"([^"]+)"\s+([\d.]+)/)
    if (m) staticAxes[m[1]] = parseFloat(m[2])
  }

  // ── Seek frame-by-frame, read live DOM state, render ───────────────────
  const frames: Blob[] = []

  for (let i = 0; i < totalFrames; i++) {
    const t = (i / totalFrames) * effectiveDuration

    // Seek the timeline — GSAP applies transforms/opacity to each char span
    timeline.seek(t, false)
    // Force a style flush so getComputedStyle reflects the seek
    void stage.offsetHeight

    // Interpolate variable-font axes for this frame
    let variationOverride: string | undefined
    if (axisKfs.length > 0) {
      const normalizedT = i / totalFrames
      const interpolated = interpolateAxes(axisKfs, normalizedT, staticAxes)
      variationOverride = axesToVariationSettings(interpolated)
      stage.style.fontVariationSettings = variationOverride
    }

    const canvas = renderFrameFromDom(
      geom, font, containerW, containerH, BAKE_SCALE, variationOverride,
    )

    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (blob) frames.push(blob)

    onProgress?.(i + 1, totalFrames)
  }

  // Cleanup
  destroy()
  document.body.removeChild(stage)

  return frames
}

// ── Composable wrapper ──────────────────────────────────────────────────────

export function useKineticRenderer() {
  const isBaking = ref(false)
  const bakeProgress = ref(0)   // 0..1

  async function bake(state: KineticState): Promise<string[]> {
    isBaking.value = true
    bakeProgress.value = 0

    try {
      const frames = await bakeFrames(state, (current, total) => {
        bakeProgress.value = current / total
      })

      if (frames.length === 0) return []

      const filenames = await uploadFrameBatch(frames, 'kinetic')
      return filenames
    } finally {
      isBaking.value = false
      bakeProgress.value = 0
    }
  }

  return {
    isBaking,
    bakeProgress,
    bake,
    buildPreview,
  }
}
