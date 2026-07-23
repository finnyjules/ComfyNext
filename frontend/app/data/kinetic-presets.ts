/**
 * Kinetic typography preset catalog.
 *
 * Each preset is a function that builds a GSAP timeline animating individual
 * characters, words, or lines. The timeline is:
 *   - played on real DOM for the live preview (instant, no bake)
 *   - seeked frame-by-frame for the canvas bake (frame sequence output)
 *
 * Organized into three tabs: In (reveal), Out (exit), Loop.
 * Each preset belongs to a subcategory (Slide, Scale, Blur, etc.) shown
 * as section headers within the tab.
 */

import { PRESET_PARAM_DEFAULTS } from '~/lib/motion/evaluate'

export type KineticCategory = 'in' | 'out' | 'loop'

export type KineticGroup =
  | 'appear' | 'slide' | 'scale' | 'blur' | 'rotate'
  | 'mask' | 'glitch' | 'text' | 'physics'
  | 'oscillate' | 'pulse' | 'color' | 'utility'
  // (slide, scale, blur, rotate, glitch also used by loop presets)

export interface KineticBuildContext {
  tl: gsap.core.Timeline
  chars: HTMLElement[]
  words: HTMLElement[]
  lines: HTMLElement[]
  container: HTMLElement
  opts: KineticOpts
}

export interface KineticOpts {
  duration: number
  stagger: number
  ease: string
}

export interface KineticPreset {
  id: string
  label: string
  pitch: string
  category: KineticCategory
  /** Visual grouping within the category tab. */
  group: KineticGroup
  /** Which split level this preset primarily animates. */
  splitLevel: 'chars' | 'words' | 'lines'
  /** Build the GSAP timeline. Optional — canvas-native presets (utility
   *  group) are evaluated directly by lib/motion/evaluate.ts and have no
   *  GSAP builder; that path is legacy slate-only. */
  build?: (ctx: KineticBuildContext) => void
  /** Jitter-style per-preset knobs, shown in the picker when present. */
  params?: KineticParamSpec[]
}

/** Jitter-style per-preset knob. Defaults live in PRESET_PARAM_DEFAULTS
 *  (lib/motion/evaluate.ts) — the engine is the source of truth. */
export interface KineticParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
}

export function presetParamDefault(presetId: string, key: string): number {
  return PRESET_PARAM_DEFAULTS[presetId]?.[key] ?? 0
}

export const DEFAULT_KINETIC_OPTS: KineticOpts = {
  duration: 2.0,
  stagger: 0.04,
  ease: 'power2.out',
}

// ── IN (reveal) ─────────────────────────────────────────────────────────────

const IN_PRESETS: KineticPreset[] = [
  // Appear
  { id: 'appear', label: 'Appear', pitch: 'Instant staggered appear', category: 'in', group: 'appear', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { opacity: 0, duration: 0.01, stagger: opts.stagger * 2 }) } },
  { id: 'fade-in', label: 'Fade In', pitch: 'Soft opacity fade with stagger', category: 'in', group: 'appear', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: opts.ease }) } },

  // Slide
  { id: 'slide-up', label: 'Slide Up', pitch: 'Chars rise from below', category: 'in', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { y: 40, opacity: 0, duration: opts.duration * 0.6, stagger: opts.stagger, ease: opts.ease }) } },
  { id: 'slide-down', label: 'Slide Down', pitch: 'Chars drop from above', category: 'in', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { y: -40, opacity: 0, duration: opts.duration * 0.6, stagger: opts.stagger, ease: opts.ease }) } },
  { id: 'slide-left', label: 'Slide Left', pitch: 'Chars slide in from right', category: 'in', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { x: 40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: opts.ease }) } },
  { id: 'slide-right', label: 'Slide Right', pitch: 'Chars slide in from left', category: 'in', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { x: -40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: opts.ease }) } },

  // Mask
  { id: 'mask-up', label: 'Mask Up', pitch: 'Chars clip-reveal from below', category: 'in', group: 'mask', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { y: 20, clipPath: 'inset(100% 0 0 0)', duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.out' }) } },
  { id: 'mask-down', label: 'Mask Down', pitch: 'Chars clip-reveal from above', category: 'in', group: 'mask', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { y: -20, clipPath: 'inset(0 0 100% 0)', duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.out' }) } },

  // Scale
  { id: 'grow-in', label: 'Grow In', pitch: 'Chars scale up from zero', category: 'in', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { scale: 0, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'back.out(1.7)' }) } },
  { id: 'shrink-in', label: 'Shrink In', pitch: 'Chars scale down from large', category: 'in', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { scale: 2.5, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.out' }) } },

  // Blur
  { id: 'blur-in', label: 'Blur In', pitch: 'Chars sharpen from blur', category: 'in', group: 'blur', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { filter: 'blur(12px)', opacity: 0, duration: opts.duration * 0.6, stagger: opts.stagger, ease: opts.ease }) } },
  { id: 'zoom-blur-in', label: 'Zoom Blur', pitch: 'Rush in from behind with blur', category: 'in', group: 'blur', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { scale: 3, filter: 'blur(8px)', opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.out' }) } },

  // Rotate
  { id: 'spin-in', label: 'Spin In', pitch: 'Each char rotates while appearing', category: 'in', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { rotation: 180, scale: 0, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'back.out(1.4)', transformOrigin: '50% 50%' }) } },
  { id: 'flip-in', label: 'Flip In', pitch: '3D flip on the Y axis', category: 'in', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { rotationY: 90, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.out', transformOrigin: '50% 50%', transformPerspective: 600 }) } },
  { id: 'swing-in', label: 'Swing', pitch: 'Pendulum swing from top', category: 'in', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { rotation: -90, opacity: 0, duration: opts.duration * 0.6, stagger: opts.stagger, ease: 'elastic.out(1.2, 0.5)', transformOrigin: '50% 0%' }) } },
  { id: 'roll-in', label: 'Roll In', pitch: 'Tumble in from the side', category: 'in', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { x: -40, rotation: -120, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'back.out(1.2)', transformOrigin: 'bottom center' }) } },

  // Physics
  { id: 'elastic-drop', label: 'Elastic Drop', pitch: 'Drop with elastic bounce', category: 'in', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { y: -80, opacity: 0, duration: opts.duration * 0.7, stagger: opts.stagger, ease: 'elastic.out(1, 0.3)' }) } },
  { id: 'rubber-band', label: 'Rubber Band', pitch: 'Squash and stretch into place', category: 'in', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { scaleX: 1.4, scaleY: 0.6, opacity: 0, duration: opts.duration * 0.4, stagger: opts.stagger, ease: 'elastic.out(1, 0.4)' }) } },
  { id: 'curtain', label: 'Curtain', pitch: 'Chars split apart from center', category: 'in', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { const mid = chars.length / 2; chars.forEach((char, i) => { const dir = i < mid ? -1 : 1; const dist = Math.abs(i - mid) * 20 + 40; tl.from(char, { x: dir * dist, opacity: 0, duration: opts.duration * 0.5, ease: 'power3.out' }, Math.abs(i - mid) * opts.stagger * 0.5) }) } },

  // Glitch
  { id: 'glitch-in', label: 'Glitch', pitch: 'Random flicker, settles to position', category: 'in', group: 'glitch', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { const o = i * opts.stagger; tl.fromTo(char, { x: () => (Math.random() - 0.5) * 60, y: () => (Math.random() - 0.5) * 30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: opts.duration * 0.3, ease: 'steps(6)' }, o); tl.to(char, { x: 0, y: 0, duration: opts.duration * 0.2, ease: 'power2.out' }, o + opts.duration * 0.3) }) } },

  // Text
  { id: 'typewriter', label: 'Typewriter', pitch: 'Chars appear one by one', category: 'in', group: 'text', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.from(chars, { opacity: 0, duration: 0.01, stagger: opts.stagger * 2 }) } },
  { id: 'scramble-in', label: 'Scramble Decode', pitch: 'Random chars resolve to text', category: 'in', group: 'text', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { const original = char.textContent || ''; tl.from(char, { opacity: 0, duration: 0.05 }, i * opts.stagger); tl.to(char, { duration: opts.duration * 0.4, scrambleText: { text: original, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%', speed: 0.6 } }, i * opts.stagger + 0.05) }) } },

  // Utility (canvas-native; no GSAP builder)
  { id: 'card-flip-h', label: 'Card Flip H', pitch: 'Horizontal card-flip reveal', category: 'in', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
  { id: 'card-flip-v', label: 'Card Flip V', pitch: 'Vertical card-flip reveal', category: 'in', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
]

// ── OUT (exit) — mirrors every IN preset ────────────────────────────────────

const OUT_PRESETS: KineticPreset[] = [
  // Appear (↔ appear, fade-in)
  { id: 'disappear', label: 'Disappear', pitch: 'Instant staggered disappear', category: 'out', group: 'appear', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { opacity: 0, duration: 0.01, stagger: opts.stagger * 2 }) } },
  { id: 'fade-out', label: 'Fade Out', pitch: 'Soft opacity fade out', category: 'out', group: 'appear', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },

  // Slide (↔ slide-up, slide-down, slide-left, slide-right)
  { id: 'slide-out-up', label: 'Slide Up', pitch: 'Chars exit upward', category: 'out', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { y: -40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },
  { id: 'slide-out-down', label: 'Slide Down', pitch: 'Chars exit downward', category: 'out', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { y: 40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },
  { id: 'slide-out-left', label: 'Slide Left', pitch: 'Chars exit to the left', category: 'out', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { x: -40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },
  { id: 'slide-out-right', label: 'Slide Right', pitch: 'Chars exit to the right', category: 'out', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { x: 40, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },

  // Mask (↔ mask-up, mask-down)
  { id: 'mask-out-up', label: 'Mask Up', pitch: 'Chars clip away upward', category: 'out', group: 'mask', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { y: -20, clipPath: 'inset(0 0 100% 0)', duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in' }) } },
  { id: 'mask-out-down', label: 'Mask Down', pitch: 'Chars clip away downward', category: 'out', group: 'mask', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { y: 20, clipPath: 'inset(100% 0 0 0)', duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in' }) } },

  // Scale (↔ grow-in, shrink-in)
  { id: 'shrink-out', label: 'Shrink Out', pitch: 'Chars shrink to nothing', category: 'out', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { scale: 0, opacity: 0, duration: opts.duration * 0.4, stagger: opts.stagger, ease: 'back.in(1.7)' }) } },
  { id: 'grow-out', label: 'Grow Out', pitch: 'Chars scale up and vanish', category: 'out', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { scale: 2.5, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in' }) } },

  // Blur (↔ blur-in, zoom-blur-in)
  { id: 'blur-out', label: 'Blur Out', pitch: 'Chars blur and vanish', category: 'out', group: 'blur', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { filter: 'blur(12px)', opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power2.in' }) } },
  { id: 'zoom-blur-out', label: 'Zoom Blur', pitch: 'Rush away with blur', category: 'out', group: 'blur', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { scale: 3, filter: 'blur(8px)', opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in' }) } },

  // Rotate (↔ spin-in, flip-in, swing-in, roll-in)
  { id: 'spin-out', label: 'Spin Out', pitch: 'Chars spin and shrink away', category: 'out', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { rotation: 180, scale: 0, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in', transformOrigin: '50% 50%' }) } },
  { id: 'flip-out', label: 'Flip Out', pitch: '3D flip away on the Y axis', category: 'out', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { rotationY: -90, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in', transformOrigin: '50% 50%', transformPerspective: 600 }) } },
  { id: 'swing-out', label: 'Swing Out', pitch: 'Pendulum swing away', category: 'out', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { rotation: 90, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in', transformOrigin: '50% 0%' }) } },
  { id: 'roll-out', label: 'Roll Out', pitch: 'Tumble away to the side', category: 'out', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { x: 40, rotation: 120, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'power3.in', transformOrigin: 'bottom center' }) } },

  // Physics (↔ elastic-drop, rubber-band, curtain)
  { id: 'elastic-launch', label: 'Elastic Launch', pitch: 'Bounce upward and vanish', category: 'out', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { y: -80, opacity: 0, duration: opts.duration * 0.5, stagger: opts.stagger, ease: 'back.in(2)' }) } },
  { id: 'rubber-band-out', label: 'Rubber Band', pitch: 'Stretch and snap away', category: 'out', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to(chars, { scaleX: 1.4, scaleY: 0.6, opacity: 0, duration: opts.duration * 0.4, stagger: opts.stagger, ease: 'back.in(2)' }) } },
  { id: 'curtain-close', label: 'Curtain Close', pitch: 'Chars collapse to center', category: 'out', group: 'physics', splitLevel: 'chars',
    build({ tl, chars, opts }) { const mid = chars.length / 2; chars.forEach((char, i) => { const dir = i < mid ? 1 : -1; const dist = Math.abs(i - mid) * 20 + 40; tl.to(char, { x: dir * dist, opacity: 0, duration: opts.duration * 0.5, ease: 'power3.in' }, Math.abs(i - mid) * opts.stagger * 0.5) }) } },

  // Glitch (↔ glitch-in)
  { id: 'glitch-out', label: 'Glitch', pitch: 'Flicker and scatter away', category: 'out', group: 'glitch', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { const o = i * opts.stagger; tl.to(char, { x: () => (Math.random() - 0.5) * 60, y: () => (Math.random() - 0.5) * 30, opacity: 0, duration: opts.duration * 0.3, ease: 'steps(6)' }, o) }) } },

  // Text (↔ typewriter, scramble-in)
  { id: 'typewriter-out', label: 'Typewriter', pitch: 'Chars vanish one by one', category: 'out', group: 'text', splitLevel: 'chars',
    build({ tl, chars, opts }) { tl.to([...chars].reverse(), { opacity: 0, duration: 0.01, stagger: opts.stagger * 2 }) } },
  { id: 'scramble-out', label: 'Scramble Out', pitch: 'Dissolves into random chars', category: 'out', group: 'text', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { duration: opts.duration * 0.4, scrambleText: { text: ' ', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%', speed: 0.4 } }, i * opts.stagger); tl.to(char, { opacity: 0, duration: 0.1 }, i * opts.stagger + opts.duration * 0.35) }) } },

  // Utility
  { id: 'card-flip-h-out', label: 'Card Flip H', pitch: 'Horizontal card-flip exit', category: 'out', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
  { id: 'card-flip-v-out', label: 'Card Flip V', pitch: 'Vertical card-flip exit', category: 'out', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
]

// ── LOOP ─────────────────────────────────────────────────────────────────────

const LOOP_PRESETS: KineticPreset[] = [
  // ── Oscillate ─────────────────────────────────────────────────────────────
  { id: 'wave', label: 'Wave', pitch: 'Sine wave oscillation', category: 'loop', group: 'oscillate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { y: -20, duration: opts.duration * 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger }, 0) }) } },
  { id: 'bounce', label: 'Bounce', pitch: 'Bounce up and down', category: 'loop', group: 'oscillate', splitLevel: 'words',
    build({ tl, words, opts }) { words.forEach((word, i) => { tl.to(word, { y: -30, duration: opts.duration * 0.25, ease: 'power2.out', repeat: -1, yoyo: true, delay: i * opts.stagger * 4 }, 0) }) } },
  { id: 'jello', label: 'Jello', pitch: 'Wobbly elastic wiggle', category: 'loop', group: 'oscillate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { skewX: 8, duration: opts.duration * 0.15, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger }, 0); tl.to(char, { skewY: -4, duration: opts.duration * 0.2, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger + 0.1 }, 0) }) } },
  { id: 'float', label: 'Float', pitch: 'Gentle floating drift', category: 'loop', group: 'oscillate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { y: -8, x: 3, duration: opts.duration * 0.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger * 2 }, 0) }) } },
  { id: 'sway', label: 'Sway', pitch: 'Pendulum sway left and right', category: 'loop', group: 'oscillate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { rotation: 8, duration: opts.duration * 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger, transformOrigin: 'top center' }, 0) }) } },
  { id: 'tremble', label: 'Tremble', pitch: 'Rapid micro-shake', category: 'loop', group: 'oscillate', splitLevel: 'chars',
    build({ tl, chars }) { chars.forEach((char, i) => { tl.to(char, { x: 2, duration: 0.04, ease: 'steps(1)', repeat: -1, yoyo: true, delay: i * 0.02 }, 0); tl.to(char, { y: -1, duration: 0.06, ease: 'steps(1)', repeat: -1, yoyo: true, delay: i * 0.03 }, 0) }) } },

  // ── Pulse ──────────────────────────────────────────────────────────────────
  { id: 'breathe', label: 'Breathe', pitch: 'Gentle scale pulse', category: 'loop', group: 'pulse', splitLevel: 'words',
    build({ tl, container }) { tl.to(container, { scale: 1.06, duration: 1, ease: 'sine.inOut', repeat: -1, yoyo: true }) } },
  { id: 'heartbeat', label: 'Heartbeat', pitch: 'Double-pulse like a heartbeat', category: 'loop', group: 'pulse', splitLevel: 'words',
    build({ tl, container }) { tl.to(container, { scale: 1.08, duration: 0.15, ease: 'power2.out' }); tl.to(container, { scale: 1, duration: 0.15, ease: 'power2.in' }); tl.to(container, { scale: 1.12, duration: 0.15, ease: 'power2.out' }); tl.to(container, { scale: 1, duration: 0.6, ease: 'power2.out' }); tl.repeat(-1) } },
  { id: 'neon-flicker', label: 'Neon Flicker', pitch: 'Flicker like a neon sign', category: 'loop', group: 'pulse', splitLevel: 'chars',
    build({ tl, chars }) { chars.forEach((char, i) => { tl.to(char, { opacity: 0.2, duration: 0.05, ease: 'steps(1)' }, i * 0.3); tl.to(char, { opacity: 1, duration: 0.05, ease: 'steps(1)' }, i * 0.3 + 0.05); tl.to(char, { opacity: 0.3, duration: 0.08, ease: 'steps(1)' }, i * 0.3 + 0.15); tl.to(char, { opacity: 1, duration: 0.05, ease: 'steps(1)' }, i * 0.3 + 0.23); tl.to(char, { opacity: 0.6, duration: 0.1, ease: 'steps(1)' }, i * 0.3 + 0.5); tl.to(char, { opacity: 1, duration: 0.05, ease: 'steps(1)' }, i * 0.3 + 0.6) }) } },
  { id: 'throb', label: 'Throb', pitch: 'Per-char staggered scale pulse', category: 'loop', group: 'pulse', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { scale: 1.2, duration: opts.duration * 0.2, ease: 'power2.out', repeat: -1, yoyo: true, delay: i * opts.stagger * 2 }, 0) }) } },

  // ── Color ──────────────────────────────────────────────────────────────────
  { id: 'color-cycle', label: 'Color Cycle', pitch: 'Rainbow hue shift', category: 'loop', group: 'color', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { const hue = (i / chars.length) * 360; tl.to(char, { color: `hsl(${hue}, 80%, 65%)`, duration: opts.duration * 0.5, ease: 'none', repeat: -1, yoyo: true, delay: i * opts.stagger }, 0) }) } },
  { id: 'color-wave', label: 'Color Wave', pitch: 'Traveling highlight across chars', category: 'loop', group: 'color', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { color: '#818cf8', duration: opts.duration * 0.15, ease: 'power2.out', repeat: -1, yoyo: true, delay: i * opts.stagger * 3 }, 0) }) } },

  // ── Glitch ─────────────────────────────────────────────────────────────────
  { id: 'glitch-loop', label: 'Glitch', pitch: 'Random position jitter', category: 'loop', group: 'glitch', splitLevel: 'chars',
    build({ tl, chars }) { chars.forEach((char, i) => { tl.to(char, { x: 4, duration: 0.05, ease: 'steps(1)', repeat: -1, yoyo: true, delay: i * 0.07 }, 0); tl.to(char, { y: -2, duration: 0.08, ease: 'steps(1)', repeat: -1, yoyo: true, delay: i * 0.05 + 0.03 }, 0) }) } },
  { id: 'scan-line', label: 'Scan Line', pitch: 'VHS-style horizontal offset sweep', category: 'loop', group: 'glitch', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { x: 6, opacity: 0.7, duration: 0.08, ease: 'steps(1)' }, i * 0.15); tl.to(char, { x: 0, opacity: 1, duration: 0.08, ease: 'steps(1)' }, i * 0.15 + 0.08) }); tl.repeat(-1) } },

  // ── Rotate ─────────────────────────────────────────────────────────────────
  { id: 'spin-loop', label: 'Spin', pitch: 'Continuous rotation', category: 'loop', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { rotation: 360, duration: opts.duration * 0.8, ease: 'none', repeat: -1, delay: i * opts.stagger * 2, transformOrigin: '50% 50%' }, 0) }) } },
  { id: 'rock', label: 'Rock', pitch: 'Tilt back and forth', category: 'loop', group: 'rotate', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { rotation: 12, duration: opts.duration * 0.25, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger, transformOrigin: '50% 100%' }, 0) }) } },

  // ── Scale ──────────────────────────────────────────────────────────────────
  { id: 'rubber-loop', label: 'Rubber', pitch: 'Squash and stretch loop', category: 'loop', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { scaleY: 1.15, scaleX: 0.9, duration: opts.duration * 0.15, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger, transformOrigin: '50% 100%' }, 0) }) } },
  { id: 'pop-loop', label: 'Pop', pitch: 'Staggered scale pop', category: 'loop', group: 'scale', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { scale: 1.3, duration: opts.duration * 0.1, ease: 'back.out(3)', repeat: -1, repeatDelay: opts.duration * 0.5, delay: i * opts.stagger * 3, transformOrigin: '50% 100%' }, 0); tl.to(char, { scale: 1, duration: opts.duration * 0.15, ease: 'power2.out' }, i * opts.stagger * 3 + opts.duration * 0.1) }) } },

  // ── Blur ───────────────────────────────────────────────────────────────────
  { id: 'focus-pull', label: 'Focus Pull', pitch: 'Staggered blur in and out', category: 'loop', group: 'blur', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { tl.to(char, { filter: 'blur(4px)', opacity: 0.5, duration: opts.duration * 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger * 3 }, 0) }) } },

  // ── Slide ──────────────────────────────────────────────────────────────────
  { id: 'marquee', label: 'Marquee', pitch: 'News-ticker horizontal scroll', category: 'loop', group: 'slide', splitLevel: 'words',
    build({ tl, container, opts }) { tl.fromTo(container, { x: '100%' }, { x: '-100%', duration: opts.duration * 2, ease: 'none', repeat: -1 }) } },
  { id: 'shuffle', label: 'Shuffle', pitch: 'Chars swap positions randomly', category: 'loop', group: 'slide', splitLevel: 'chars',
    build({ tl, chars, opts }) { chars.forEach((char, i) => { const dir = i % 2 === 0 ? 1 : -1; tl.to(char, { x: dir * 12, duration: opts.duration * 0.2, ease: 'power2.inOut', repeat: -1, yoyo: true, delay: i * opts.stagger * 2 }, 0) }) } },

  // Utility
  { id: 'wiggle', label: 'Wiggle', pitch: 'Organic positional jitter', category: 'loop', group: 'utility', splitLevel: 'chars',
    params: [
      { key: 'amplitude', label: 'Amplitude', min: 0.02, max: 0.5, step: 0.01 },
      { key: 'cycles', label: 'Speed', min: 1, max: 6, step: 1 },
    ] },
  { id: 'inward-echoes', label: 'Inward Echoes', pitch: 'Echo trail collapsing inward', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'copies', label: 'Copies', min: 1, max: 6, step: 1 },
      { key: 'scaleStep', label: 'Spread', min: 0.1, max: 0.8, step: 0.05 },
      { key: 'fade', label: 'Fade', min: 0.2, max: 0.9, step: 0.05 },
    ] },
  { id: 'grid-scroll-x', label: 'Grid Scroll X', pitch: 'Tiled horizontal marquee', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 4, step: 1 },
      { key: 'gap', label: 'Gap', min: 1, max: 3, step: 0.1 },
    ] },
  { id: 'grid-scroll-y', label: 'Grid Scroll Y', pitch: 'Tiled vertical marquee', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 4, step: 1 },
      { key: 'gap', label: 'Gap', min: 1, max: 3, step: 0.1 },
    ] },
  { id: 'noise-tile', label: 'Noise Tile', pitch: 'Flickering tile grid', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 3, step: 1 },
      { key: 'flicker', label: 'Flicker', min: 0.2, max: 1, step: 0.05 },
    ] },
]

// ── Combined ────────────────────────────────────────────────────────────────

export const KINETIC_PRESETS: KineticPreset[] = [...IN_PRESETS, ...OUT_PRESETS, ...LOOP_PRESETS]

export const KINETIC_PRESETS_BY_ID: Record<string, KineticPreset> = Object.fromEntries(
  KINETIC_PRESETS.map(p => [p.id, p]),
)

export const DEFAULT_KINETIC_PRESET_ID = 'slide-up'

export const KINETIC_CATEGORY_LABELS: Record<KineticCategory, string> = {
  in: 'In',
  out: 'Out',
  loop: 'Loop',
}

export const KINETIC_GROUP_LABELS: Record<KineticGroup, string> = {
  appear: 'Appear',
  slide: 'Slide',
  mask: 'Mask',
  scale: 'Scale',
  blur: 'Blur',
  rotate: 'Rotate',
  physics: 'Physics',
  glitch: 'Glitch',
  text: 'Text',
  oscillate: 'Oscillate',
  pulse: 'Pulse',
  color: 'Color',
  utility: 'Utility',
}

/** Available GSAP ease presets for the dropdown. */
export const EASE_OPTIONS = [
  { id: 'power2.out', label: 'Smooth' },
  { id: 'power3.out', label: 'Dramatic' },
  { id: 'power4.out', label: 'Snappy' },
  { id: 'back.out(1.7)', label: 'Overshoot' },
  { id: 'elastic.out(1,0.3)', label: 'Elastic' },
  { id: 'bounce.out', label: 'Bounce' },
  { id: 'sine.inOut', label: 'Gentle' },
  { id: 'steps(8)', label: 'Stepped' },
  { id: 'none', label: 'Linear' },
]
