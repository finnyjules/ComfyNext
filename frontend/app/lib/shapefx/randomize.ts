import { makeRng, randomSeed } from './rng'
import { HARMONY_TYPES } from '../color/harmony'
import type { ShapeConfig, ShapeParams, PaletteParams, StyleParams, PrimitiveKind } from './config'

const PRIMS: PrimitiveKind[] = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron']

function rollShape(seed: string, prev: ShapeParams): ShapeParams {
  const r = makeRng(seed, 'shape')
  return {
    ...prev,
    // keep the current mode + primitive family, roll the generative knobs
    primitive: prev.mode === 'primitive' ? r.pick(PRIMS) : prev.primitive,
    vertices: r.int(6, 24),
    depth: +r.range(0.5, 1.6).toFixed(2),
    spread: +r.range(0.35, 0.95).toFixed(2),
    density: r.int(0, 3),
  }
}

function rollPalette(seed: string, prev: PaletteParams): PaletteParams {
  const r = makeRng(seed, 'palette')
  return {
    ...prev,
    harmony: r.pick(HARMONY_TYPES),
    baseHue: r.int(0, 359),
    saturation: r.int(35, 80),
    lightness: r.int(35, 60),
  }
}

function rollStyle(seed: string, prev: StyleParams): StyleParams {
  const r = makeRng(seed, 'style')
  // `grain` is deliberately NOT rolled (Task 8). It is a one-shot migration input
  // consumed and dropped by mergeConfig (see StyleParams.grain) — writing a fresh
  // value onto a live config would make the next load treat the document as
  // un-migrated and overwrite whatever the user had set on the shared Grain
  // controls. Grain now lives in `post`, which re-roll does not touch at all
  // (neither does any other studio's re-roll).
  return { ...prev, distortion: r.int(0, 20) }
}

/** Fresh seed + regenerate each UNLOCKED section; locked sections carry over unchanged. */
export function reroll(config: ShapeConfig): ShapeConfig {
  const seed = randomSeed()
  return {
    ...config,
    seed,
    fill: { ...config.fill },
    locks: { ...config.locks },
    shape: config.locks.shape ? { ...config.shape } : rollShape(seed, config.shape),
    palette: config.locks.palette ? { ...config.palette } : rollPalette(seed, config.palette),
    style: config.locks.style ? { ...config.style } : rollStyle(seed, config.style),
  }
}
