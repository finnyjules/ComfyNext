import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { ribbonRowState, buildRibbonLabel, type RibbonParams } from '../ribbonMath'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'VESSEL' },
  { key: 'case', label: 'Case', kind: 'select', options: ['upper', 'as-typed'], default: 'upper' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 3, max: 24, step: 1, default: 11 },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 0.4, max: 2, step: 0.05, default: 0.9 },
  { key: 'zRotation', label: 'Twist', kind: 'slider', min: 0, max: 1.2, step: 0.01, default: 0.35 },
  { key: 'waveAmplitude', label: 'Wave', kind: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.5 },
  { key: 'waveFrequency', label: 'Wave freq', kind: 'slider', min: 0.5, max: 6, step: 0.1, default: 2 },
  { key: 'rowPhase', label: 'Row phase', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.15 },
  { key: 'scrollSpeed', label: 'Scroll', kind: 'slider', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'cameraTilt', label: 'Camera tilt', kind: 'slider', min: -0.6, max: 0.6, step: 0.01, default: 0.15 },
  { key: 'typeColor', label: 'Type color', kind: 'color', default: '#f5f5f7' },
]

interface Row {
  mesh: THREE.Mesh
  uniforms: { uWavePhase: { value: number }; uWaveAmp: { value: number }; uWaveFreq: { value: number } }
}

const RIBBON_LEN = 16   // world units along X (the ribbon's length)
const RIBBON_W = 1.0    // world height of a single ribbon band

let rows: Row[] = []

function n(params: Params, key: string): number { return Number(params[key]) }

/** Build a wave-capable material from a repeating text texture. */
function ribbonMaterial(tex: THREE.Texture, uniforms: Row['uniforms']): THREE.Material {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWavePhase = uniforms.uWavePhase
    shader.uniforms.uWaveAmp = uniforms.uWaveAmp
    shader.uniforms.uWaveFreq = uniforms.uWaveFreq
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWavePhase;\nuniform float uWaveAmp;\nuniform float uWaveFreq;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.z += sin(position.x * uWaveFreq + uWavePhase) * uWaveAmp;',
      )
  }
  return mat
}

export const ribbonEffect: SpaceTypeEffect = {
  id: 'ribbon',
  label: 'Ribbon',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    rows = []
    const count = Math.max(1, Math.floor(n(params, 'rows')))
    for (let i = 0; i < count; i++) {
      const geo = new three.PlaneGeometry(RIBBON_LEN, RIBBON_W, 200, 1)
      const uniforms = { uWavePhase: { value: 0 }, uWaveAmp: { value: n(params, 'waveAmplitude') }, uWaveFreq: { value: n(params, 'waveFrequency') } }
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.repeat.set(RIBBON_LEN / RIBBON_W, 1)
      const mesh = new three.Mesh(geo, ribbonMaterial(tex, uniforms))
      mesh.userData.tex = tex
      root.add(mesh)
      rows.push({ mesh, uniforms })
    }
    return root
  },

  update(t01, params) {
    const rp: RibbonParams = {
      rows: n(params, 'rows'), rowSpacing: n(params, 'rowSpacing'), zRotation: n(params, 'zRotation'),
      waveAmplitude: n(params, 'waveAmplitude'), waveFrequency: n(params, 'waveFrequency'),
      rowPhase: n(params, 'rowPhase'), scrollSpeed: n(params, 'scrollSpeed'), scrollCycles: 1, waveCycles: 1,
    }
    for (let i = 0; i < rows.length; i++) {
      const s = ribbonRowState(t01, i, rp)
      const r = rows[i]
      if (!r) continue
      r.mesh.position.y = s.y
      r.mesh.rotation.z = s.zRotation
      r.uniforms.uWavePhase.value = s.wavePhase
      r.uniforms.uWaveAmp.value = rp.waveAmplitude
      r.uniforms.uWaveFreq.value = rp.waveFrequency
      const tex = r.mesh.userData.tex as THREE.Texture
      tex.offset.x = -s.scrollOffset * (RIBBON_LEN / RIBBON_W)
    }
  },
}

/** Re-exported so the surface can compose the label the same way the texture does. */
export { buildRibbonLabel }
