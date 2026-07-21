// Config generation + scoped re-rolls. Everything here is deterministic from the
// seed string, so a given seed always reproduces the same gradient (modulo locks).

import { buildMeshPoints, defaultMesh, recolorMeshPoints } from './mesh'
import { hslToRgb, rgbToHex } from './ramp'
import { makeRng, randomSeed, type Rng } from './rng'
import {
  BLEND_MODES, DEFAULT_CENTER, DEFAULT_FLOW, DEFAULT_LIGHT, DIRECTIONS, LAYOUTS, MAPPINGS, SHAPE_KINDS, cloneConfig,
  type CenterOffset, type ColorConfig, type ColorStop, type FlowConfig, type GradientConfig, type LayerConfig,
  type LayoutKind, type LightConfig, type MeshConfig, type ShapeConfig,
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
  const mesh = layout === 'mesh'
  return {
    angle: rng.range(0, 360),
    noiseScale: rng.range(1.5, 5),
    // Mesh gets a gentle warp so the blobs ripple; liquid gets a strong one.
    intensity: liquid ? rng.range(45, 85) : mesh ? rng.range(15, 40) : (rng.chance(0.4) ? rng.range(10, 45) : 0),
    distortion: rng.range(40, 90),
    detail: rng.int(1, 3),
    depth: rng.range(40, 75),
    highlights: rng.range(35, 65),
    shadows: rng.range(40, 70),
    foldScale: rng.range(40, 80),
    // Living drift on by default for liquid/mesh so the result is alive out of the box.
    speed: liquid ? rng.range(18, 45) : mesh ? rng.range(12, 32) : 0,
    gloss: liquid ? rng.range(25, 60) : 0,
    // Liquid surface: marbled veins + a touch of viscosity/refraction so a random
    // liquid reads as fluid (not smoke). 0 for every other layout.
    veins: liquid ? rng.range(25, 65) : 0,
    veinScale: rng.range(20, 55),
    ripple: liquid ? (rng.chance(0.5) ? rng.range(15, 45) : 0) : 0,
    refract: liquid ? rng.range(10, 40) : 0,
    viscosity: liquid ? rng.range(20, 55) : 0,
    swirl: liquid ? rng.range(15, 50) : 0,
  }
}

/** Random mesh config — 5..9 points coloured from the layer palette, soft default look. */
function randMesh(rng: Rng, stops: ColorStop[], seed: string): MeshConfig {
  return {
    points: buildMeshPoints(rng.int(5, 9), stops, seed),
    softness: rng.range(42, 72),
    contrast: rng.chance(0.4) ? rng.range(15, 55) : rng.range(0, 18),
    blur: rng.chance(0.4) ? rng.range(15, 45) : 0,
    drift: rng.range(20, 55),
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
    canvas: { aspect: '16:9', layout: 'liquid', margin: 0, innerRadius: 0.4, background: '#000000', center: { ...DEFAULT_CENTER } },
    relief: { grain: 1, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { angle: 45, noiseScale: 0.9, intensity: 100, distortion: 94, detail: 1, depth: 32, highlights: 0, shadows: 0, foldScale: 0, speed: 25, gloss: 0, veins: 0, veinScale: 35, ripple: 0, refract: 47, viscosity: 100, swirl: 50 },
    layers: [
      {
        blend: 'normal', opacity: 1,
        // Shape is unused by the liquid layout but kept so the layer schema stays complete.
        shape: { type: 'bands', count: 20, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        color: { stops: [{ color: '#311a2a', pos: 0 }, { color: '#c026d3', pos: 0.4 }, { color: '#ff7d46', pos: 0.64 }, { color: '#f1ddac', pos: 1 }], gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
    focus: { blur: 100, shape: 'off', x: 0, y: 0, radius: 0.25, softness: 40, angle: 0 },
  }
}

/**
 * The "Mesh" preset — a soft Stripe-style point mesh: a handful of warm pastel
 * points bleeding into each other over a dark base, with a gentle living drift.
 */
export function meshConfig(seed = randomSeed()): GradientConfig {
  const stops: ColorStop[] = [
    { color: '#ff8a5b', pos: 0 }, { color: '#ffd2a6', pos: 0.3 },
    { color: '#f7a8d8', pos: 0.6 }, { color: '#7b6cff', pos: 0.82 }, { color: '#1d1340', pos: 1 },
  ]
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'mesh', margin: 0, innerRadius: 0, background: '#100a24', center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.12, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { ...DEFAULT_FLOW, intensity: 24, noiseScale: 2.6, distortion: 60, detail: 2, speed: 22 },
    layers: [
      {
        blend: 'normal', opacity: 1,
        shape: { type: 'bands', count: 12, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        color: { stops, gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
        mesh: { points: buildMeshPoints(7, stops, seed), softness: 58, contrast: 16, blur: 22, drift: 32 },
      },
    ],
    motion: { tracks: [], duration: 6, fps: 30, size: 1080 },
    locks: {},
  }
}

/** Named liquid looks — each a stops palette + flow tweaks over the liquid layout. */
export type LiquidPreset = 'marble' | 'oil' | 'ink' | 'lava' | 'satin'
export const LIQUID_PRESETS: LiquidPreset[] = ['marble', 'oil', 'ink', 'lava', 'satin']

const LIQUID_LOOKS: Record<LiquidPreset, { bg: string; stops: ColorStop[]; flow: Partial<FlowConfig> }> = {
  marble: {
    bg: '#0c0a14',
    stops: [{ color: '#f6f1ea', pos: 0 }, { color: '#d7dbe4', pos: 0.45 }, { color: '#8b93a6', pos: 0.78 }, { color: '#3a3f52', pos: 1 }],
    flow: { angle: 30, noiseScale: 2.4, intensity: 60, distortion: 92, detail: 3, depth: 38, highlights: 55, shadows: 40, foldScale: 34, gloss: 18, speed: 14, veins: 58, veinScale: 30, refract: 18, viscosity: 34 },
  },
  oil: {
    bg: '#0a0a16',
    stops: [{ color: '#3ee0d0', pos: 0 }, { color: '#7b5bff', pos: 0.3 }, { color: '#ff5bb0', pos: 0.55 }, { color: '#ffd24a', pos: 0.8 }, { color: '#3a2e6b', pos: 1 }],
    flow: { angle: 60, noiseScale: 3.0, intensity: 74, distortion: 82, detail: 3, depth: 52, highlights: 62, shadows: 40, foldScale: 40, gloss: 55, speed: 28, veins: 34, veinScale: 28, ripple: 40, refract: 40, viscosity: 22 },
  },
  ink: {
    bg: '#070708',
    stops: [{ color: '#ffffff', pos: 0 }, { color: '#a7adb8', pos: 0.32 }, { color: '#383c46', pos: 0.62 }, { color: '#08080a', pos: 1 }],
    flow: { angle: 120, noiseScale: 3.0, intensity: 84, distortion: 94, detail: 3, depth: 34, highlights: 48, shadows: 55, foldScale: 38, gloss: 12, speed: 24, veins: 70, veinScale: 42, refract: 22, viscosity: 30 },
  },
  lava: {
    bg: '#0a0402',
    stops: [{ color: '#fff1a8', pos: 0 }, { color: '#ff8a2b', pos: 0.32 }, { color: '#e2331b', pos: 0.6 }, { color: '#5c0d12', pos: 0.82 }, { color: '#120406', pos: 1 }],
    flow: { angle: 90, noiseScale: 2.6, intensity: 68, distortion: 78, detail: 3, depth: 62, highlights: 72, shadows: 48, foldScale: 44, gloss: 38, speed: 20, veins: 42, veinScale: 24, ripple: 26, viscosity: 44 },
  },
  satin: {
    bg: '#0c0814',
    stops: [{ color: '#f7c9e3', pos: 0 }, { color: '#c9a8ff', pos: 0.38 }, { color: '#7ec7ff', pos: 0.68 }, { color: '#3a3170', pos: 1 }],
    flow: { angle: 45, noiseScale: 2.6, intensity: 56, distortion: 72, detail: 2, depth: 44, highlights: 60, shadows: 42, foldScale: 42, gloss: 44, speed: 18, veins: 22, veinScale: 26, ripple: 30, refract: 24, viscosity: 38 },
  },
}

/** Build one of the named liquid looks. */
export function liquidPresetConfig(name: LiquidPreset, seed = randomSeed()): GradientConfig {
  const look = LIQUID_LOOKS[name]
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'liquid', margin: 0, innerRadius: 0, background: look.bg, center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.16, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { ...DEFAULT_FLOW, ...look.flow },
    layers: [
      {
        blend: 'normal', opacity: 1,
        shape: { type: 'bands', count: 12, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        color: { stops: look.stops, gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 6, fps: 30, size: 1080 },
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
  // Mesh reads its points off layer 0; attach a fresh set coloured from its palette.
  if (layout === 'mesh') layers[0]!.mesh = randMesh(rng, layers[0]!.color.stops, seed)
  return {
    seed,
    canvas: {
      aspect,
      // Mesh wants a dark base so the soft points read; force a near-black bg.
      layout,
      margin: rng.range(0, 0.18),
      innerRadius: rng.range(0.2, 0.6),
      background: layout === 'mesh' ? '#0c0a1a' : (rng.chance(0.7) ? '#000000' : hsl(rng.range(0, 360), 0.15, rng.range(0.05, 0.25))),
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

  // Mesh upkeep on layer 0: a structure roll re-scatters the points; a colors roll
  // recolours them from the (new) palette while keeping their positions.
  if (next.canvas.layout === 'mesh') {
    const L0 = next.layers[0]!
    if (doStructure && !locks.structure) L0.mesh = randMesh(makeRng(seed, 'mesh'), L0.color.stops, seed)
    else if (!L0.mesh) L0.mesh = defaultMesh(L0.color.stops, seed)
    else if (doColors && !locks.colors) L0.mesh = { ...L0.mesh, points: recolorMeshPoints(L0.mesh.points, L0.color.stops, seed) }
  }
  return next
}
