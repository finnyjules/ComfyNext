import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildLightWidget, setWidgetSelected, disposeWidget } from '~/lib/scene3d/lightWidgets'
import { createLight } from '~/lib/scene3d/config'

const finite = (g: THREE.Object3D): boolean => {
  let ok = true
  g.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry
    if (geo) { const p = geo.getAttribute('position'); if (p) for (let i = 0; i < p.count * 3; i++) if (!Number.isFinite((p.array as ArrayLike<number>)[i])) ok = false }
  })
  return ok
}

describe('buildLightWidget', () => {
  it('builds a finite, editor-only widget for each light kind', () => {
    for (const kind of ['point', 'spot', 'rect'] as const) {
      const w = buildLightWidget(createLight(kind, []))
      expect(w).toBeInstanceOf(THREE.Group)
      expect(w.userData.isGizmoHelper).toBe(true)
      expect(w.children.length).toBeGreaterThan(0)
      expect(finite(w)).toBe(true)
    }
  })

  it('scales the spot cone with the spot angle', () => {
    const narrow = createLight('spot', []); narrow.angle = 0.2
    const wide = createLight('spot', []); wide.angle = 1.2
    const rN = new THREE.Box3().setFromObject(buildLightWidget(narrow)).getSize(new THREE.Vector3())
    const rW = new THREE.Box3().setFromObject(buildLightWidget(wide)).getSize(new THREE.Vector3())
    expect(rW.x).toBeGreaterThan(rN.x) // wider cone → wider bbox
  })

  it('dims via setWidgetSelected without throwing and disposes cleanly', () => {
    const w = buildLightWidget(createLight('point', []))
    setWidgetSelected(w, false)
    setWidgetSelected(w, true)
    expect(() => disposeWidget(w)).not.toThrow()
  })
})
