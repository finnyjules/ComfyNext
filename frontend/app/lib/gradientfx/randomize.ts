// Config generation + scoped re-rolls. Everything here is deterministic from the
// seed string, so a given seed always reproduces the same gradient (modulo locks).

import { hslToRgb, rgbToHex } from './ramp'
import { makeRng, randomSeed, type Rng } from './rng'
import {
  BLEND_MODES, DIRECTIONS, LAYOUTS, MAPPINGS, SHAPE_KINDS,
  type ColorConfig, type ColorStop, type GradientConfig, type LayerConfig, type ShapeConfig,
} from './types'

export type RerollScope = 'all' | 'colours' | 'structure'

function randShape(rng: Rng): ShapeConfig {
  const type = rng.pick(SHAPE_KINDS)
  return {
    type,
    count: rng.int(5, type === 'noise' ? 24 : 14),
    minDepth: rng.range(0, 0.4),
    curveExp: rng.range(0.6, 2.4),
    jitter: rng.chance(0.4) ? rng.range(0, 0.35) : 0,
    peaks: rng.int(1, 6),
    phase: rng.next(),
    detail: rng.int(2, 6),
    sweep: rng.range(120, 360),
    scrub: rng.next(),
    gap: rng.chance(0.5) ? rng.range(0, 0.4) : 0,
    rounding: rng.range(0, 1),
    direction: rng.pick(DIRECTIONS),
    mirror: rng.chance(0.5),
    valley: rng.range(0.15, 0.85),
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

function randColour(rng: Rng): ColorConfig {
  return {
    stops: randStops(rng),
    mapping: rng.pick(MAPPINGS),
    steps: rng.chance(0.45) ? rng.int(3, 16) : 0,
    hueDrift: rng.chance(0.4) ? rng.range(-120, 120) : 0,
    hueRotate: rng.chance(0.3) ? rng.range(0, 360) : 0,
  }
}

function randLayer(rng: Rng, primary: boolean): LayerConfig {
  return {
    blend: primary ? 'normal' : rng.pick(BLEND_MODES.filter(b => b !== 'normal')),
    opacity: primary ? 1 : rng.range(0.5, 1),
    shape: randShape(rng),
    color: randColour(rng),
  }
}

/** A sensible default config (used for a brand-new node before any randomize). */
export function defaultConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '14:9', layout: 'linear', margin: 0.08, innerRadius: 0.4, background: '#000000' },
    relief: { grain: 0.35, relief: 0.25 },
    layers: [
      {
        blend: 'normal', opacity: 1,
        shape: { type: 'wave', count: 11, minDepth: 0.05, curveExp: 1.2, jitter: 0, peaks: 4, phase: 0, detail: 3, sweep: 360, scrub: 0, gap: 0, rounding: 0.3, direction: 'down', mirror: true, valley: 0.5 },
        color: { stops: [{ color: '#ff8a3d', pos: 0 }, { color: '#7a2bd6', pos: 0.55 }, { color: '#ffd6f2', pos: 1 }], mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
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
  return {
    seed,
    canvas: {
      aspect: rng.pick(['14:9', '16:9', '1:1', '4:5', '9:16']),
      layout: rng.pick(LAYOUTS),
      margin: rng.range(0, 0.18),
      innerRadius: rng.range(0.2, 0.6),
      background: rng.chance(0.7) ? '#000000' : hsl(rng.range(0, 360), 0.15, rng.range(0.05, 0.25)),
    },
    relief: { grain: rng.range(0.15, 0.6), relief: rng.range(0, 0.5) },
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
  const next: GradientConfig = structuredClone(prev)
  next.seed = seed

  const doStructure = scope === 'all' || scope === 'structure'
  const doColours = scope === 'all' || scope === 'colours'

  if (scope === 'all' && !locks.layout) next.canvas.layout = rng.pick(LAYOUTS)
  if (scope === 'all' && !locks.aspect) next.canvas.aspect = rng.pick(['14:9', '16:9', '1:1', '4:5', '9:16'])
  if (scope === 'all' && !locks.background) {
    next.canvas.background = rng.chance(0.7) ? '#000000' : hsl(rng.range(0, 360), 0.15, rng.range(0.05, 0.25))
    next.canvas.margin = rng.range(0, 0.18)
  }
  if (scope === 'all') next.relief = { grain: rng.range(0.15, 0.6), relief: rng.range(0, 0.5) }

  // Optionally flip the layer count on a full roll.
  if (scope === 'all' && !locks.structure) {
    const want = rng.chance(0.55) ? 2 : 1
    while (next.layers.length < want) next.layers.push(randLayer(rng, false))
    if (next.layers.length > want) next.layers.length = want
  }

  next.layers.forEach((layer, i) => {
    if (doStructure && !locks.structure) layer.shape = randShape(makeRng(seed, `struct${i}`))
    if (doColours && !locks.colours) {
      const c = randColour(makeRng(seed, `col${i}`))
      layer.color = c
      if (i > 0) { layer.blend = rng.pick(BLEND_MODES.filter(b => b !== 'normal')); layer.opacity = rng.range(0.5, 1) }
    }
  })
  return next
}
