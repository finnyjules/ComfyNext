import * as THREE from 'three'
import { harmonize, toStops } from '../color/harmony'
import { oklchToHex } from '../color/convert'
import { makeRng } from './rng'
import type { ShapeConfig } from './config'

/** How many stops the interpolated ramp is expanded to before sampling. */
const RAMP_N = 8

/** Build the seed hex from HSL-ish palette params, then expand via the harmony engine. */
export function paletteFor(config: ShapeConfig): string[] {
  const { baseHue, saturation, lightness, harmony } = config.palette
  // harmony works in OKLCH; map the studio's hue/sat/light sliders to an OKLCH seed.
  const L = 0.25 + (lightness / 100) * 0.6      // 0.25–0.85
  const C = (saturation / 100) * 0.22           // 0–0.22 chroma
  const seedHex = oklchToHex(L, C, baseHue)
  // Use each harmony's NATURAL swatch count; over-requesting cycles hues into duplicate swatches.
  const out = harmonize(seedHex, harmony)
  return out.length ? out : [seedHex]
}

/** The interpolated dark→light ramp — the SAME gradient the palette bar previews. */
function rampColors(config: ShapeConfig): THREE.Color[] {
  return toStops(paletteFor(config), RAMP_N).map(s => new THREE.Color(s.color))
}

/** Sample the evenly-spaced ramp at t∈[0,1], linearly interpolating between adjacent stops. */
function sampleRamp(ramp: THREE.Color[], t: number, out: THREE.Color): void {
  const tt = t < 0 ? 0 : t > 1 ? 1 : t
  const f = tt * (ramp.length - 1)
  const i0 = Math.floor(f)
  const i1 = Math.min(ramp.length - 1, i0 + 1)
  out.copy(ramp[i0]!).lerp(ramp[i1]!, f - i0)
}

/**
 * Assign a color to every vertex and write a `color` attribute. Non-indexed geometry means
 * each triangle owns 3 vertices; `config.palette.coloring` decides how the palette is painted:
 *   smooth  — per-vertex sample of the interpolated ramp along `direction` → gradient sweeps
 *             the whole surface (the mesh interpolates vertex colors across each facet)
 *   faceted — one flat ramp-tone per facet (sampled at its centroid), progressing smoothly
 *   scatter — each facet a random discrete swatch + per-vertex jitter (low-poly confetti)
 * `direction` (smooth/faceted) maps a vertex/centroid position to t∈[0,1]:
 *   vertical=Y, depth=Z, radial=distance from the Y axis, angular=angle around it.
 */
export function applyVertexColors(geometry: THREE.BufferGeometry, config: ShapeConfig): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute
  const n = pos.count
  const colors = new Float32Array(n * 3)

  // ── Scatter: discrete random pick + jitter (seeded, order-stable) ──
  if (config.palette.coloring === 'scatter') {
    const palette = paletteFor(config).map(h => new THREE.Color(h))
    const rng = makeRng(config.seed, 'facetcolor')
    for (let tri = 0; tri < n; tri += 3) {
      const base = palette[rng.int(0, palette.length - 1)]!
      for (let k = 0; k < 3; k++) {
        const j = 1 + (rng.next() - 0.5) * 0.18
        const idx = (tri + k) * 3
        colors[idx] = Math.min(1, base.r * j)
        colors[idx + 1] = Math.min(1, base.g * j)
        colors[idx + 2] = Math.min(1, base.b * j)
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return
  }

  // ── Smooth / faceted: sample the interpolated ramp by position along `direction` ──
  const ramp = rampColors(config)
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, minR = Infinity, maxR = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = Math.hypot(x, y)
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
    if (r < minR) minR = r; if (r > maxR) maxR = r
  }
  const spanY = maxY - minY || 1, spanZ = maxZ - minZ || 1, spanR = maxR - minR || 1
  const dir = config.palette.direction
  const tOf = (x: number, y: number, z: number): number => {
    switch (dir) {
      case 'depth': return (z - minZ) / spanZ
      case 'radial': return (Math.hypot(x, y) - minR) / spanR
      case 'angular': return (Math.atan2(y, x) + Math.PI) / (2 * Math.PI)
      default: return (y - minY) / spanY // vertical
    }
  }

  const tmp = new THREE.Color()
  if (config.palette.coloring === 'faceted') {
    for (let tri = 0; tri < n; tri += 3) {
      let cx = 0, cy = 0, cz = 0
      for (let k = 0; k < 3; k++) { cx += pos.getX(tri + k); cy += pos.getY(tri + k); cz += pos.getZ(tri + k) }
      sampleRamp(ramp, tOf(cx / 3, cy / 3, cz / 3), tmp)
      for (let k = 0; k < 3; k++) {
        const idx = (tri + k) * 3
        colors[idx] = tmp.r; colors[idx + 1] = tmp.g; colors[idx + 2] = tmp.b
      }
    }
  } else { // smooth
    for (let i = 0; i < n; i++) {
      sampleRamp(ramp, tOf(pos.getX(i), pos.getY(i), pos.getZ(i)), tmp)
      const idx = i * 3
      colors[idx] = tmp.r; colors[idx + 1] = tmp.g; colors[idx + 2] = tmp.b
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}
