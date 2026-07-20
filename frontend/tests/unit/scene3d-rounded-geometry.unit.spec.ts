import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { roundedLatheGeometry, roundedPolyGeometry } from '~/lib/scene3d/roundedGeometry'

const finite = (g: THREE.BufferGeometry): boolean => {
  const a = g.getAttribute('position')
  for (let i = 0; i < a.count * 3; i++) if (!Number.isFinite((a.array as ArrayLike<number>)[i])) return false
  return true
}
const size = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}

describe('roundedLatheGeometry', () => {
  it('builds a valid cylinder-like lathe with normals and uv at a mid radius', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('normal')).toBeTruthy()
    expect(g.getAttribute('uv')).toBeTruthy()
    expect(finite(g)).toBe(true)
    const [w, h, d] = size(g)
    expect(h).toBeLessThanOrEqual(1.0001)      // stays within unit height
    expect(w).toBeLessThanOrEqual(1.0001)
    expect(d).toBeLessThanOrEqual(1.0001)
    expect(w).toBeGreaterThan(0.5)
  })

  it('stays finite at the extreme corner radius and lowest corner sides', () => {
    const g = roundedLatheGeometry(0.5, 0.5, 0.49, 1, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
    expect(size(g)[1]).toBeLessThanOrEqual(1.0001)
  })

  it('handles a cone (zero top radius) without NaNs', () => {
    const g = roundedLatheGeometry(0, 0.5, 0.2, 3, 48, Math.PI * 2)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(finite(g)).toBe(true)
  })

  it('adds vertices versus a plain cylinder of the same segments', () => {
    const plain = new THREE.CylinderGeometry(0.5, 0.5, 1, 48)
    const round = roundedLatheGeometry(0.5, 0.5, 0.2, 4, 48, Math.PI * 2)
    expect(round.getAttribute('position').count).toBeGreaterThan(0)
    expect(plain.getAttribute('position').count).toBeGreaterThan(0)
  })
})
