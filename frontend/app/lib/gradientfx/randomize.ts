// Config generation + scoped re-rolls. Everything here is deterministic from the
// seed string, so a given seed always reproduces the same gradient (modulo locks).

import { hslToRgb, rgbToHex } from './ramp'
import { makeRng, randomSeed, type Rng } from './rng'
import {
  BLEND_MODES, DEFAULT_CENTER, DEFAULT_FLOW, DEFAULT_LIGHT, DIRECTIONS, LAYOUTS, MAPPINGS, SHAPE_KINDS, cloneConfig,
  type CenterOffset, type ColorConfig, type ColorStop, type FlowConfig, type GradientConfig, type LayerConfig,
  type LayoutKind, type LightConfig, type ShapeConfig,
} from './types'

export type RerollScope = 'all' | 'colors' | 'structure'

function randShape(rng: Rng): ShapeConfig {
  // Bias toward 'bands' — the signature crisp-gradient-band wave look.
  const type = rng.pick(['bands', 'bands', 'wave', 'noise', 'pyramid'] as const)
  return {
    type,
    count: type === 'bands' ? rng.int(10, 28) : rng.int(5, type === 'noise' ? 24 : 14),
    minDepth: rng.range(0, 0.4),
    curveExp: rng.range(0.6, 2.4),
    jitter: rng.chance(0.4) ? rng.range(0, 0.35) : 0,
    peaks: rng.int(1, 6),
    phase: rng.next(),
    detail: rng.int(2, 6),
    sweep: rng.range(120, 360),
    scrub: rng.next(),
    // Gaps mostly off (the signature linear look is gapless full-height columns).
    gap: rng.chance(0.22) ? rng.range(0.05, 0.3) : 0,
    rounding: rng.range(0, 0.8),
    // Bias to vertical fills — up/down read as the staggered-skyline look.
    direction: rng.pick(['up', 'down', 'up', 'down', 'left', 'right'] as const),
    mirror: rng.pick(['none', 'none', 'none', 'horizontal', 'vertical', 'both'] as const),
    valley: rng.range(0.15, 0.85),
    // Stack-only (ignored by other layouts): rotation per ring + off-center pivot + contour.
    rotStep: rng.range(3, 18),
    pivot: rng.chance(0.6) ? rng.range(0.04, 0.22) : 0,
    ringScale: rng.chance(0.4) ? rng.range(1, 1.8) : 1,
    ringShape: rng.pick(['circle', 'circle', 'diamond', 'square'] as const),
  }
}

// A few palette strategies inspired by the reference's grainy duotones / neon rings.
type Scheme = 'duotone' | 'analogous' | 'triad' | 'neon' | 'eclipse'
const SCHEMES: Scheme[] = ['duotone', 'analogous', 'triad', 'neon', 'eclipse']

function hsl(h: number, s: number, l: number): string {
  return rgbToHex(hslToRgb(h, s, l))
}

function randStops(rng: Rng): ColorStop[] {
  const scheme = rng.pick(SCHEMES)
  const base = rng.range(0, 360)
  const stops: ColorStop[] = []
  const push = (color: string, pos: number) => stops.push({ color, pos })
  switch (scheme) {
    case 'duotone':
      push(hsl(base, rng.range(0.5, 0.9), rng.range(0.45, 0.7)), 0)
      push(hsl(base + rng.range(20, 60), rng.range(0.5, 0.95), rng.range(0.4, 0.65)), 1)
      break
    case 'analogous':
      push(hsl(base, 0.7, 0.4), 0)
      push(hsl(base + 30, 0.75, 0.55), 0.5)
      push(hsl(base + 60, 0.8, 0.7), 1)
      break
    case 'triad':
      push(hsl(base, 0.75, 0.55), 0)
      push(hsl(base + 120, 0.75, 0.55), 0.5)
      push(hsl(base + 240, 0.75, 0.55), 1)
      break
    case 'neon':
      push('#0a0a12', 0)
      push(hsl(base, 0.95, 0.6), rng.range(0.4, 0.6))
      push(hsl(base + rng.range(60, 180), 0.95, 0.65), 1)
      break
    case 'eclipse':
      push('#000000', 0)
      push(hsl(base, 0.85, 0.55), rng.range(0.55, 0.8))
      push(hsl(base + rng.range(-30, 30), 0.7, 0.85), 1)
      break
  }
  return stops
}

function randColor(rng: Rng): ColorConfig {
  // Bias toward 'field' — the signature staggered-gradient look — over flat/across.
  const mapping = rng.pick(['field', 'field', 'field', 'across', 'perbar'] as const)
  return {
    stops: randStops(rng),
    gradientDir: rng.pick(['vertical', 'vertical', 'horizontal'] as const),
    mapping,
    steps: rng.chance(0.3) ? rng.int(3, 16) : 0,
    hueDrift: rng.chance(0.35) ? rng.range(-90, 90) : 0,
    hueRotate: rng.chance(0.3) ? rng.range(0, 360) : 0,
  }
}

function randLayer(rng: Rng, primary: boolean): LayerConfig {
  return {
    blend: primary ? 'normal' : rng.pick(BLEND_MODES.filter(b => b !== 'normal')),
    opacity: primary ? 1 : rng.range(0.5, 1),
    shape: randShape(rng),
    color: randColor(rng),
  }
}

/** Random light direction; gentle off-axis bias so the emboss reads. */
function randLight(rng: Rng): LightConfig {
  return { azimuth: rng.range(0, 360), elevation: rng.range(25, 65) }
}

/** Random flow/warp params. Liquid layouts get a strong warp; geometric layouts get a subtle one (often none). */
function randFlow(rng: Rng, layout: LayoutKind): FlowConfig {
  const liquid = layout === 'liquid'
  return {
    angle: rng.range(0, 360),
    noiseScale: rng.range(1.5, 5),
    intensity: liquid ? rng.range(45, 85) : (rng.chance(0.4) ? rng.range(10, 45) : 0),
    distortion: rng.range(40, 90),
    detail: rng.int(1, 3),
    depth: rng.range(40, 75),
    highlights: rng.range(35, 65),
    shadows: rng.range(40, 70),
    foldScale: rng.range(40, 80),
  }
}

/** Random origin offset for radial/orbit — small so the disc stays roughly framed. */
function randCenter(rng: Rng): CenterOffset {
  return { x: rng.range(-0.18, 0.18), y: rng.range(-0.18, 0.18) }
}

/**
 * Full-spectrum angular ramp (blue → cyan → yellow → orange → pink), wrapping back
 * to blue so an orbit's angular gradient has no visible seam.
 */
export function spectrumStops(): ColorStop[] {
  return [
    { color: '#3b4cff', pos: 0 },
    { color: '#37d0e6', pos: 0.22 },
    { color: '#e6f23a', pos: 0.46 },
    { color: '#f0a35a', pos: 0.7 },
    { color: '#f7b8d8', pos: 0.86 },
    { color: '#3b4cff', pos: 1 },
  ]
}

/**
 * The "Rainbow ripple" preset — concentric 3D-embossed orbit rings under a spectrum
 * angular ramp, rippling from a slightly low-set core. Reproduces the reference look.
 */
export function rippleConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'orbit', margin: 0.06, innerRadius: 0, background: '#000000', center: { x: 0, y: 0.08 } },
    relief: { grain: 0.12, relief: 0.85, light: { azimuth: 135, elevation: 42 } },
    flow: { ...DEFAULT_FLOW },
    layers: [
      {
        blend: 'normal', opacity: 1,
        // High minDepth → rings are near-uniform tubes; rounding fattens the ridge.
        shape: { type: 'bands', count: 10, minDepth: 0.78, curveExp: 1, jitter: 0, peaks: 2, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0.88, direction: 'up', mirror: 'none', valley: 0.5 },
        // Angular spectrum: vertical gradientDir + field mapping runs the ramp around the ring.
        color: { stops: spectrumStops(), gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}

/**
 * The "Stacked rings" preset — the reference's real construction: concentric circles of
 * shrinking radius, each filled with the same linear gradient rotated a step per ring, with
 * a slight per-ring orbit for the off-centre spiral core.
 */
export function stackConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'stack', margin: 0.06, innerRadius: 0, background: '#000000', center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.1, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { ...DEFAULT_FLOW },
    layers: [
      {
        blend: 'normal', opacity: 1,
        // count = ring count; rotStep + pivot drive the ripple/spiral. Other shape fields unused.
        shape: { type: 'bands', count: 13, minDepth: 0.5, curveExp: 1, jitter: 0, peaks: 2, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0.5, direction: 'up', mirror: 'none', valley: 0.5, rotStep: 8, pivot: 0.1, ringScale: 1, ringShape: 'circle' },
        // Reference ramp: blue → yellow → orange → pink (linear; rotated per ring).
        color: { stops: [{ color: '#5b6ee8', pos: 0 }, { color: '#e9f25a', pos: 0.34 }, { color: '#f3a85f', pos: 0.6 }, { color: '#f6c2e2', pos: 1 }], gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}

/**
 * The "Liquid" preset — a domain-warped marble flow (neato.fun look): the ramp smeared
 * through fbm noise, warm orange→peach→pink melting into deep indigo, with fold shading.
 */
export function liquidConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'liquid', margin: 0, innerRadius: 0, background: '#0e0a1e', center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.18, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { angle: 45, noiseScale: 3.5, intensity: 72, distortion: 80, detail: 2, depth: 60, highlights: 50, shadows: 55, foldScale: 60 },
    layers: [
      {
        blend: 'normal', opacity: 1,
        // Shape is unused by the liquid layout but kept so the layer schema stays complete.
        shape: { type: 'bands', count: 12, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        color: { stops: [{ color: '#ff7a3d', pos: 0 }, { color: '#f6c39b', pos: 0.25 }, { color: '#f5a6cd', pos: 0.5 }, { color: '#2b3a55', pos: 0.75 }, { color: '#171327', pos: 1 }], gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}

/** A sensible default config (used for a brand-new node before any randomize). */
export function defaultConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '16:9', layout: 'linear', margin: 0, innerRadius: 0.4, background: '#000000', center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.22, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { ...DEFAULT_FLOW },
    layers: [
      {
        blend: 'normal', opacity: 1,
        shape: { type: 'bands', count: 20, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        // Bottom→top vertical gradient: pink → magenta → near-black → orange (the reference look).
        color: { stops: [{ color: '#f9d9f0', pos: 0 }, { color: '#c026d3', pos: 0.4 }, { color: '#0e0a1e', pos: 0.64 }, { color: '#f0a35a', pos: 1 }], gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}

/** Fully random config from a seed (deterministic). */
export function buildConfig(seed: string): GradientConfig {
  const rng = makeRng(seed, 'build')
  const twoLayers = rng.chance(0.55)
  const layers: LayerConfig[] = [randLayer(rng, true)]
  if (twoLayers) layers.push(randLayer(rng, false))
  const aspect = rng.pick(['14:9', '16:9', '1:1', '4:5', '9:16'] as const)
  const layout = rng.pick(LAYOUTS)
  return {
    seed,
    canvas: {
      aspect,
      layout,
      margin: rng.range(0, 0.18),
      innerRadius: rng.range(0.2, 0.6),
      background: rng.chance(0.7) ? '#000000' : hsl(rng.range(0, 360), 0.15, rng.range(0.05, 0.25)),
      center: rng.chance(0.4) ? randCenter(rng) : { ...DEFAULT_CENTER },
    },
    relief: { grain: rng.range(0.15, 0.6), relief: rng.range(0, 0.5), light: randLight(rng) },
    flow: randFlow(rng, layout),
    layers,
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}

/**
 * Re-roll part of a config. `scope` decides what changes; `locks` (by key)
 * pin fields so they survive any re-roll. Returns a NEW config object.
 */
export function reroll(prev: GradientConfig, scope: RerollScope, seed = randomSeed()): GradientConfig {
  const locks = prev.locks ?? {}
  const rng = makeRng(seed, scope)
  const next: GradientConfig = cloneConfig(prev)
  next.seed = seed

  const doStructure = scope === 'all' || scope === 'structure'
  const doColors = scope === 'all' || scope === 'colors'

  if (scope === 'all' && !locks.layout) next.canvas.layout = rng.pick(LAYOUTS)
  if (scope === 'all' && !locks.aspect) next.canvas.aspect = rng.pick(['14:9', '16:9', '1:1', '4:5', '9:16'])
  if (scope === 'all' && !locks.background) {
    next.canvas.background = rng.chance(0.7) ? '#000000' : hsl(rng.range(0, 360), 0.15, rng.range(0.05, 0.25))
    next.canvas.margin = rng.range(0, 0.18)
  }
  if (scope === 'all') {
    next.relief = { grain: rng.range(0.15, 0.6), relief: rng.range(0, 0.5), light: randLight(rng) }
    next.canvas.center = rng.chance(0.4) ? randCenter(rng) : { ...DEFAULT_CENTER }
  }
  // Always guarantee the optional fields exist after any re-roll (back-compat).
  if (!next.relief.light) next.relief.light = { ...DEFAULT_LIGHT }
  if (!next.canvas.center) next.canvas.center = { ...DEFAULT_CENTER }
  if (doStructure && !locks.flow) next.flow = randFlow(makeRng(seed, 'flow'), next.canvas.layout)
  if (!next.flow) next.flow = { ...DEFAULT_FLOW }

  // Optionally flip the layer count on a full roll.
  if (scope === 'all' && !locks.structure) {
    const want = rng.chance(0.55) ? 2 : 1
    while (next.layers.length < want) next.layers.push(randLayer(rng, false))
    if (next.layers.length > want) next.layers.length = want
  }

  next.layers.forEach((layer, i) => {
    if (doStructure && !locks.structure) layer.shape = randShape(makeRng(seed, `struct${i}`))
    if (doColors && !locks.colors) {
      const c = randColor(makeRng(seed, `col${i}`))
      layer.color = c
      if (i > 0) { layer.blend = rng.pick(BLEND_MODES.filter(b => b !== 'normal')); layer.opacity = rng.range(0.5, 1) }
    }
  })
  return next
}
