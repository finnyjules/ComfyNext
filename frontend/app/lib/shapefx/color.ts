import * as THREE from 'three'
import { harmonize } from '../color/harmony'
import { oklchToHex } from '../color/convert'
import { makeRng } from './rng'
import type { ShapeConfig } from './config'

/** Build the seed hex from HSL-ish palette params, then expand via the harmony engine. */
export function paletteFor(config: ShapeConfig): string[] {
  const { baseHue, saturation, lightness, harmony } = config.palette
  // harmony works in OKLCH; map the studio's hue/sat/light sliders to an OKLCH seed.
  const L = 0.25 + (lightness / 100) * 0.6      // 0.25–0.85
  const C = (saturation / 100) * 0.22           // 0–0.22 chroma
  const seedHex = oklchToHex(L, C, baseHue)
  const out = harmonize(seedHex, harmony, Math.max(5, 5))
  return out.length ? out : [seedHex]
}

/**
 * Assign a color to every vertex and write a `color` attribute. Non-indexed geometry means
 * each triangle owns 3 vertices; the `rule` decides how a facet picks from the palette:
 *   facet  — each triangle a palette member (seeded), with slight per-vertex jitter → gradient
 *   depth  — palette sampled by facet-centroid Z (front→back ramp)
 *   height — palette sampled by facet-centroid Y (bottom→top ramp)
 */
export function applyVertexColors(geometry: THREE.BufferGeometry, config: ShapeConfig): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const palette = paletteFor(config).map(h => new THREE.Color(h))
  const rng = makeRng(config.seed, 'facetcolor')
  const colors = new Float32Array(n * 3)

  // bounds for depth/height ramps
  let minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const z = pos.getZ(i), y = pos.getY(i)
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  const spanZ = maxZ - minZ || 1, spanY = maxY - minY || 1
  const sample = (t: number) => palette[Math.max(0, Math.min(palette.length - 1, Math.floor(t * palette.length)))]!

  for (let tri = 0; tri < n; tri += 3) {
    let base: THREE.Color
    if (config.palette.rule === 'facet') {
      base = palette[rng.int(0, palette.length - 1)]!
    } else {
      // centroid of the triangle
      let cz = 0, cy = 0
      for (let k = 0; k < 3; k++) { cz += pos.getZ(tri + k); cy += pos.getY(tri + k) }
      cz /= 3; cy /= 3
      const t = config.palette.rule === 'depth' ? (cz - minZ) / spanZ : (cy - minY) / spanY
      base = sample(t)
    }
    // small per-vertex tone jitter so each facet reads as a subtle gradient (the reference look)
    for (let k = 0; k < 3; k++) {
      const j = 1 + (rng.next() - 0.5) * 0.18
      const idx = (tri + k) * 3
      colors[idx] = Math.min(1, base.r * j)
      colors[idx + 1] = Math.min(1, base.g * j)
      colors[idx + 2] = Math.min(1, base.b * j)
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
