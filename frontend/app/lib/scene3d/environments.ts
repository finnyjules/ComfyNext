// Procedural environment scenes for Scene3D. Each kind is a tiny THREE.Scene fed
// to PMREMGenerator.fromScene exactly like three's RoomEnvironment — built once
// per kind switch, then disposed. HDR trick: MeshBasicMaterial colours above 1.0
// survive into the float PMREM target, so bars/panels read as light sources.
// Selected by `lighting.environment` (config.ts) — add kinds there first.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { EnvironmentKind } from './config'

type EnvScene = THREE.Scene & { dispose(): void }

class ProceduralEnv extends THREE.Scene {
  dispose(): void {
    this.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
  }
}

/** A box "light bar": w×h×d at `pos`, aimed by `rotZ`/`rotY` (radians), with an
 *  HDR colour (`intensity` multiplies the channels past LDR white). */
function bar(scene: THREE.Scene, w: number, h: number, d: number,
  pos: [number, number, number], rotY: number, rotZ: number,
  color: THREE.Color, intensity: number): void {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color: color.multiplyScalar(intensity) }),
  )
  m.position.set(...pos)
  m.rotation.set(0, rotY, rotZ)
  scene.add(m)
}

/** Black void + long thin very bright bars at varied angles — studio strip
 *  softboxes. Glass dispersion turns these streaks into rainbow bands. */
function darkStrips(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x000000)
  const white = (warmth: number) => new THREE.Color(1, 1 - warmth * 0.08, 1 - warmth * 0.15)
  bar(s, 8, 0.35, 0.1, [-4, 4, -5], 0.4, 0.5, white(1), 10)
  bar(s, 10, 0.3, 0.1, [5, 3, -4], -0.5, -0.6, white(0), 12)
  bar(s, 7, 0.25, 0.1, [0, -3.5, -5], 0.1, 0.35, white(-1), 8)   // cool from below
  bar(s, 9, 0.3, 0.1, [-5, -1, 4], 2.6, -0.4, white(0.5), 9)
  bar(s, 6, 0.4, 0.1, [4, 5, 3], 2.9, 0.7, white(-0.5), 11)
  bar(s, 8, 0.2, 0.1, [0, 6, 0], 1.2, 1.57, white(0), 7)          // overhead
  return s
}

/** Mid-grey void + two huge soft white panels — the classic product-render
 *  studio: big gradient windows sliding across curved surfaces. */
function softbox(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x2a2a2a)
  bar(s, 6, 4.5, 0.1, [-4, 3, -3], 0.7, 0, new THREE.Color(1, 1, 1), 6)   // key
  bar(s, 4, 3, 0.1, [4.5, 1, 2], -2.2, 0, new THREE.Color(1, 1, 1), 2.5)  // fill
  return s
}

/** Black void + opposing magenta/cyan area sources — two-tone neon look. */
function colorGels(): EnvScene {
  const s = new ProceduralEnv()
  s.background = new THREE.Color(0x000000)
  bar(s, 5, 4, 0.1, [-4.5, 1.5, -1], 1.1, 0, new THREE.Color(1, 0.05, 0.65), 7)  // magenta
  bar(s, 5, 4, 0.1, [4.5, 1.5, -1], -1.1, 0, new THREE.Color(0.05, 0.8, 1), 7)   // cyan
  bar(s, 3, 0.3, 0.1, [0, 5.5, 2], 0, 1.57, new THREE.Color(1, 1, 1), 4)          // white rim strip
  return s
}

export function buildEnvironmentScene(kind: EnvironmentKind): EnvScene {
  switch (kind) {
    case 'darkStrips': return darkStrips()
    case 'softbox': return softbox()
    case 'colorGels': return colorGels()
    case 'room': default: return new RoomEnvironment() as unknown as EnvScene
  }
}
