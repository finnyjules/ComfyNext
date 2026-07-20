// Editor-only Light-View widgets: an explicit, legible representation of each
// light's position, strength, reach, and direction. Built in the light's LOCAL
// space (the light emits along local -Z for spot/rect) and added as a child of
// the light root, so it follows the light's transform and is excluded from export
// by the recursive isGizmoHelper filter in passes.ts.
import * as THREE from 'three'
import { stripAlpha } from '~/lib/color/convert'
import { type LightObject, LIGHT_DEFAULTS } from '~/lib/scene3d/config'

const INDICATIVE_RANGE = 6 // shown reach when distance = 0 (infinite)
const lineMat = (color: THREE.Color, opacity = 0.9) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false })

/** Intensity → ring radius: a gentle log map so a bright light reads bigger
 *  without dwarfing the scene. */
function intensityRadius(intensity: number): number {
  return 0.25 + Math.min(1.5, Math.log2(1 + Math.max(0, intensity)) * 0.18)
}

/** A closed ring of `segments` points at `radius` in the local XY plane — no
 *  center vertex (CircleGeometry's center makes a LineLoop draw spokes). */
function ringLoop(radius: number, segments: number, mat: THREE.LineBasicMaterial): THREE.LineLoop {
  const pts: number[] = []
  for (let i = 0; i < segments; i++) {
    const th = (i / segments) * Math.PI * 2
    pts.push(Math.cos(th) * radius, Math.sin(th) * radius, 0)
  }
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return new THREE.LineLoop(geo, mat)
}

export function buildLightWidget(obj: LightObject): THREE.Group {
  const group = new THREE.Group()
  group.userData.isGizmoHelper = true
  const color = new THREE.Color(stripAlpha(obj.color))
  const range = (obj.distance ?? 0) > 0 ? obj.distance! : INDICATIVE_RANGE

  // Intensity ring (faces local +Z, i.e. toward the marker), radius by intensity.
  const rr = intensityRadius(obj.intensity)
  const ring = ringLoop(rr, 40, lineMat(color))
  group.add(ring)

  if (obj.light === 'point') {
    // Falloff sphere (three great circles) + short rays.
    for (let a = 0; a < 3; a++) {
      const c = ringLoop(range, 48, lineMat(color, 0.35))
      if (a === 1) c.rotation.x = Math.PI / 2
      if (a === 2) c.rotation.y = Math.PI / 2
      group.add(c)
    }
    const rayPts: number[] = []
    for (let i = 0; i < 6; i++) { const th = (i / 6) * Math.PI * 2; rayPts.push(0, 0, 0, Math.cos(th) * rr * 1.6, Math.sin(th) * rr * 1.6, 0) }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rayPts, 3)), lineMat(color)))
  } else if (obj.light === 'spot') {
    const angle = obj.angle ?? LIGHT_DEFAULTS.angle
    const r = Math.tan(angle) * range
    // Cone edges from apex (origin) to a -Z circle of radius r.
    const seg = 32, pts: number[] = []
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2, x = Math.cos(th) * r, y = Math.sin(th) * r
      pts.push(0, 0, 0, x, y, -range)                      // apex → rim
      const th2 = ((i + 1) / seg) * Math.PI * 2
      pts.push(x, y, -range, Math.cos(th2) * r, Math.sin(th2) * r, -range) // rim arc
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), lineMat(color)))
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), range * 0.6, color.getHex()))
  } else { // rect
    const w = (obj.width ?? LIGHT_DEFAULTS.width) / 2, h = (obj.height ?? LIGHT_DEFAULTS.height) / 2
    const rect = [-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0, -w, -h, 0]
    group.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rect, 3)), lineMat(color)))
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 1.5, color.getHex()))
  }

  // Aim line toward -Z for directional lights.
  if (obj.light !== 'point') {
    group.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -range], 3)), lineMat(color, 0.4)))
  }
  return group
}

export function setWidgetSelected(group: THREE.Group, selected: boolean): void {
  group.traverse((o) => {
    const m = (o as THREE.Line).material as THREE.Material | undefined
    if (m && 'opacity' in m) { (m as THREE.LineBasicMaterial).opacity = selected ? 1 : 0.28; m.needsUpdate = false }
  })
}

export function disposeWidget(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else if (m) m.dispose()
  })
}
