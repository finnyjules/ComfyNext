/**
 * useAnimatedTextRenderer — renders TitleClip and LowerThirdClip
 * directly into the timeline's playback canvas.
 *
 * Called by the playback engine for each animated text clip at each frame.
 * Uses GSAP easing math (without full SplitText DOM) for lightweight
 * per-char animation during real-time playback.
 */

import type { TitleClip, LowerThirdClip, TitleSpec, LowerThirdSpec } from '~~/shared/timeline/types'
import {
  KINETIC_PRESETS_BY_ID,
  DEFAULT_KINETIC_PRESET_ID,
} from '~/data/kinetic-presets'
import { powerOut, easeInOutQuad as easeInOut, elasticOut, bounceOut } from '~/lib/motion/easing'

// ── Easing helpers (subset of GSAP eases, pure math) ────────────────────────

function easeOut(t: number, power = 2): number {
  return powerOut(power)(t)
}

function resolveEase(name: string): (t: number) => number {
  if (name.startsWith('elastic')) return elasticOut
  if (name.startsWith('bounce')) return bounceOut
  if (name.includes('InOut')) return easeInOut
  if (name === 'none' || name === 'linear') return (t) => t
  return (t) => easeOut(t)
}

// ── Per-char animation state ────────────────────────────────────────────────

interface CharAnim {
  char: string
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  opacity: number
}

/**
 * Compute per-character animation state for a reveal animation.
 * `progress` is 0..1 over the animation's duration.
 */
function computeRevealChars(
  text: string,
  presetId: string,
  progress: number,
  stagger: number,
  ease: string,
): CharAnim[] {
  const chars = [...text]
  const easeFn = resolveEase(ease)
  const preset = KINETIC_PRESETS_BY_ID[presetId] ?? KINETIC_PRESETS_BY_ID[DEFAULT_KINETIC_PRESET_ID]!

  return chars.map((char, i) => {
    // Each char has a staggered start time
    const charStart = i * stagger
    const charEnd = charStart + (1 - chars.length * stagger)
    const localT = Math.max(0, Math.min(1, (progress - charStart) / Math.max(0.01, charEnd - charStart)))
    const t = easeFn(localT)

    const result: CharAnim = { char, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, opacity: 1 }

    // Apply preset-specific animations based on the preset id
    switch (preset.id) {
      case 'stagger-up':
        result.offsetY = (1 - t) * 40
        result.opacity = t
        break
      case 'stagger-down':
        result.offsetY = (1 - t) * -40
        result.opacity = t
        break
      case 'pop-in':
        result.scale = t
        result.opacity = t
        break
      case 'elastic-drop':
        result.offsetY = (1 - t) * -80
        result.opacity = Math.min(1, t * 3)
        break
      case 'typewriter':
        result.opacity = localT > 0.01 ? 1 : 0
        break
      case 'blur-in':
        result.opacity = t
        break
      case 'rotate-in':
        result.rotation = (1 - t) * 180
        result.scale = t
        result.opacity = t
        break
      case 'slide-right':
        result.offsetX = (1 - t) * -60
        result.opacity = t
        break
      case 'fade-out-up':
        result.offsetY = -t * 40
        result.opacity = 1 - t
        break
      case 'explode':
        // For exit, t goes 0→1, we scatter
        result.offsetX = t * ((i % 2 === 0 ? 1 : -1) * 100 + i * 20)
        result.offsetY = t * ((i % 3 === 0 ? -1 : 1) * 80)
        result.scale = 1 - t
        result.opacity = 1 - t
        break
      default:
        // Generic fade in
        result.opacity = t
        break
    }

    return result
  })
}

// ── Title clip renderer ─────────────────────────────────────────────────────

/**
 * Render a TitleClip to the playback canvas at the given local frame.
 */
export function renderTitleClip(
  ctx: CanvasRenderingContext2D,
  clip: TitleClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const spec = clip.title
  const totalFrames = clip.length

  // Divide the clip into three phases: in, hold, out
  const inDuration = Math.max(1, (totalFrames - spec.hold_frames) / 2)
  const holdStart = inDuration
  const holdEnd = holdStart + spec.hold_frames
  const outStart = holdEnd
  const outDuration = totalFrames - outStart

  let phase: 'in' | 'hold' | 'out'
  let progress: number

  if (localFrame < holdStart) {
    phase = 'in'
    progress = localFrame / inDuration
  } else if (localFrame < holdEnd) {
    phase = 'hold'
    progress = 1
  } else {
    phase = 'out'
    progress = (localFrame - outStart) / Math.max(1, outDuration)
  }

  const presetId = phase === 'out' ? spec.animation_out : spec.animation_in
  const animProgress = phase === 'in' ? progress : phase === 'hold' ? 1 : progress

  const chars = computeRevealChars(
    spec.text,
    presetId,
    phase === 'out' ? animProgress : (phase === 'hold' ? 1 : animProgress),
    spec.stagger / (1 / fps),  // normalize stagger to frame-space
    spec.ease,
  )

  const fontPx = spec.font_size * canvasH
  ctx.font = `${spec.font_weight} ${fontPx}px "${spec.font_family}", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Center the text
  const totalWidth = chars.reduce((w, c) => {
    ctx.font = `${spec.font_weight} ${fontPx}px "${spec.font_family}", sans-serif`
    return w + ctx.measureText(c.char).width
  }, 0)

  let x = (canvasW - totalWidth) / 2
  const y = canvasH / 2

  for (const c of chars) {
    const charW = ctx.measureText(c.char).width
    const cx = x + charW / 2 + c.offsetX
    const cy = y + c.offsetY

    if (c.opacity <= 0.001 || !c.char.trim()) {
      x += charW
      continue
    }

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, c.opacity))
    ctx.translate(cx, cy)
    ctx.rotate((c.rotation * Math.PI) / 180)
    ctx.scale(c.scale || 0.001, c.scale || 0.001)
    ctx.fillStyle = spec.color
    ctx.fillText(c.char, 0, 0)
    ctx.restore()

    x += charW
  }
}

// ── Lower third renderer ────────────────────────────────────────────────────

/**
 * Render a LowerThirdClip to the playback canvas at the given local frame.
 */
export function renderLowerThirdClip(
  ctx: CanvasRenderingContext2D,
  clip: LowerThirdClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const spec = clip.lower_third
  const totalFrames = clip.length

  // Three phases: slide in (20% of clip), hold, slide out (20% of clip)
  const inFrames = Math.max(1, Math.floor(totalFrames * 0.15))
  const outFrames = Math.max(1, Math.floor(totalFrames * 0.15))
  const holdFrames = totalFrames - inFrames - outFrames

  let slideProgress: number  // 0 = fully hidden, 1 = fully visible
  if (localFrame < inFrames) {
    slideProgress = easeOut(localFrame / inFrames, 3)
  } else if (localFrame < inFrames + holdFrames) {
    slideProgress = 1
  } else {
    slideProgress = 1 - easeOut((localFrame - inFrames - holdFrames) / outFrames, 3)
  }

  // Layout: positioned at bottom-left
  const margin = canvasW * 0.05
  const barH = canvasH * 0.08
  const barW = canvasW * 0.4
  const barY = canvasH * 0.82

  // Animation offset based on type
  let offsetX = 0
  let offsetY = 0
  let alpha = slideProgress

  switch (spec.animation_in) {
    case 'slide-right':
      offsetX = (1 - slideProgress) * -barW
      break
    case 'slide-up':
      offsetY = (1 - slideProgress) * barH * 2
      break
    case 'fade':
      alpha = slideProgress
      break
    case 'wipe':
      // Clip width animation
      break
  }

  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha))

  const x = margin + offsetX
  const y = barY + offsetY

  if (spec.style === 'bar' || spec.style === 'boxed') {
    // Draw accent bar
    const barRadius = spec.style === 'boxed' ? 4 : 0
    ctx.fillStyle = spec.accent_color
    ctx.beginPath()
    if (barRadius > 0) {
      ctx.roundRect(x, y, barW * slideProgress, barH, barRadius)
    } else {
      ctx.rect(x, y, barW * slideProgress, barH)
    }
    ctx.fill()

    // If boxed, add a subtle background for the subtitle
    if (spec.style === 'boxed' && spec.subtitle) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.beginPath()
      ctx.roundRect(x, y + barH, barW * slideProgress, barH * 0.7, [0, 0, barRadius, barRadius])
      ctx.fill()
    }
  } else {
    // Minimal: just a small accent line
    ctx.fillStyle = spec.accent_color
    ctx.fillRect(x, y + barH - 3, barW * 0.08 * slideProgress, 3)
  }

  // Name text
  const nameFontPx = barH * 0.55
  ctx.font = `700 ${nameFontPx}px "Inter", sans-serif`
  ctx.fillStyle = spec.text_color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  if (slideProgress > 0.3) {
    const textAlpha = Math.min(1, (slideProgress - 0.3) / 0.4)
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * textAlpha))
    ctx.fillText(spec.name, x + barH * 0.3, y + barH / 2)

    // Subtitle
    if (spec.subtitle) {
      const subFontPx = barH * 0.38
      ctx.font = `400 ${subFontPx}px "Inter", sans-serif`
      ctx.fillStyle = spec.text_color
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha * textAlpha * 0.7))

      const subY = spec.style === 'boxed'
        ? y + barH + barH * 0.35
        : y + barH + subFontPx * 0.8
      ctx.fillText(spec.subtitle, x + barH * 0.3, subY)
    }
  }

  ctx.restore()
}
