/**
 * Loft — word mode. A word's glyph outlines (outer contour + hole per counter) become the
 * cross-section swept along the spine. `wordContoursFromShapes` is the pure geometry step:
 * flatten THREE.Shape[] (outer + holes) into unit-space contours, EVERY ONE resampled to the
 * same point count — `buildLoftGeometry` indexes all contours by a single P derived from
 * `baseContours[0].length`, so an unequal-length contour reads out of bounds (Task 4/8 carry-
 * forward invariant).
 *
 * NO NETWORK: parses the same checked-in Inter subset fixture the scene3d outline tests use,
 * via three's vendored opentype build (mirrors scene3d-outlines.unit.spec.ts). The fixture's
 * glyph set is " Sailorg" (see vectortype-outline's fixture note), so 'o' — with its single
 * counter — is present and exercises the outer+hole flattening.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
// @ts-expect-error — three vendors this lib without type declarations.
import opentype from 'three/examples/jsm/libs/opentype.module.js'
import { wordContoursFromShapes, outlineFontValue } from '../../app/lib/spacetype/effects/loft'
import { textOutline } from '../../app/lib/scene3d/outlines'

const fixture = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont() {
  const buf = readFileSync(fixture)
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

describe('wordContoursFromShapes', () => {
  it("resolves 'oo' into >=2 outer contours plus counters, each resampled to N points", () => {
    const font = loadFixtureFont()
    const shapes = textOutline('oo', font, { size: 1, letterSpacing: 0 }) // THREE.Shape[]
    const contours = wordContoursFromShapes(THREE as any, shapes, 32)
    // each 'o' = 1 outer + 1 hole → contours flattened >= 4 (2 outers + 2 holes)
    expect(contours.length).toBeGreaterThanOrEqual(2)
    for (const c of contours) expect(c.length).toBe(32)
  })

  it('normalises the flattened contours into a centred unit box', () => {
    const font = loadFixtureFont()
    const shapes = textOutline('S', font, { size: 1, letterSpacing: 0 })
    const contours = wordContoursFromShapes(THREE as any, shapes, 24)
    expect(contours.length).toBeGreaterThanOrEqual(1)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const c of contours) {
      expect(c.length).toBe(24)
      for (const p of c) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y)
      }
    }
    // max extent normalised to ~2 (i.e. -1..1), centred on the origin. Not exact: the
    // resample-after-normalise step redistributes points evenly by arc length, which can
    // pull the sampled extremum in very slightly from the true (pre-resample) bounding box.
    expect(Math.max(maxX - minX, maxY - minY)).toBeGreaterThan(1.9)
    expect(Math.max(maxX - minX, maxY - minY)).toBeLessThanOrEqual(2.0001)
    expect((minX + maxX) / 2).toBeCloseTo(0, 1)
    expect((minY + maxY) / 2).toBeCloseTo(0, 1)
  })

  it('returns an empty array for no shapes', () => {
    expect(wordContoursFromShapes(THREE as any, [], 16)).toEqual([])
  })
})

// Root cause: CARRY_ON_SWITCH carries 'font' across an effect switch verbatim. Ribbon's default
// is a bare family ('Inter', no `google:` prefix); loft's word mode needs a fetchable value.
// outlineFontValue normalizes both sides (wordContours here + SpaceTypeSurface's
// ensureEffectFonts) so the two fontCacheGet cache keys land on the SAME url.
describe('outlineFontValue', () => {
  it('wraps a bare family as a google value', () => { expect(outlineFontValue('Inter')).toBe('google:Inter') })
  it('passes google values through', () => { expect(outlineFontValue('google:Archivo Black@700')).toBe('google:Archivo Black@700') })
  it('passes local paths through', () => { expect(outlineFontValue('/fonts/x.ttf')).toBe('/fonts/x.ttf') })
  it('empty → default', () => { expect(outlineFontValue('')).toBe('google:Archivo Black@700') })
})
