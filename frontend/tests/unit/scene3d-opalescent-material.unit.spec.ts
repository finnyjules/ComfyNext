import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { materialFor, updateMaterial, disposeMaterial, refreshOpalTime } from '~/lib/scene3d/materials'
import { MATERIAL_DEFAULTS, OPAL_DEFAULT_STOPS, opalStopsOf, type SceneMaterial } from '~/lib/scene3d/config'

// These run headless (no WebGL): a MeshStandardMaterial and its ramp DataTexture build without a
// GL context, and onBeforeCompile is just a function we invoke against a stub shader. They guard
// the control→uniform→injection path — where the real bugs are. The actual "different hueShift
// renders different pixels / strength 0 neutralises" correlation is a live Browser-pane pixel diff
// (real WebGL), noted in the spec — a unit test here would be theatre.

const opal = (over: Partial<SceneMaterial> = {}): SceneMaterial => ({
  type: 'opalescent', color: '#334455', roughness: 0.5, metalness: 0,
  gradientStops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }],
  ...over,
})

/** Run the material's onBeforeCompile against a stub carrying the three include placeholders
 *  the opal injection targets, and return the resulting fragment source + wired uniforms. */
function compile(m: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <emissivemap_fragment>\nvec4 diffuseColor;',
  }
  ;(m as any).onBeforeCompile?.(shader)
  return shader
}

describe('opalescent material — build', () => {
  it('is a MeshStandardMaterial (full lit pipeline, not a flat decal)', () => {
    const m = materialFor(opal())
    expect((m as THREE.MeshStandardMaterial).isMeshStandardMaterial).toBe(true)
    disposeMaterial(m)
  })

  it('wires the opal uniforms from the doc — hue is normalised to 0..1', () => {
    const m = materialFor(opal({ opalHueShift: 180, opalFrequency: 3, opalAngleMix: 0.25, opalStrength: 0.7, opalFlowSpeed: 0.5 }))
    const u = m.userData.opalUniforms as Record<string, { value: number }>
    expect(u.uHueShift.value).toBeCloseTo(0.5) // 180 / 360
    expect(u.uFrequency.value).toBe(3)
    expect(u.uAngleMix.value).toBe(0.25)
    expect(u.uStrength.value).toBe(0.7)
    expect(u.uFlow.value).toBe(0.5)
    disposeMaterial(m)
  })

  it('falls back to defaults for absent opal fields', () => {
    const m = materialFor(opal())
    const u = m.userData.opalUniforms as Record<string, { value: number }>
    expect(u.uFrequency.value).toBe(MATERIAL_DEFAULTS.opalFrequency)
    expect(u.uFlow.value).toBe(MATERIAL_DEFAULTS.opalFlowSpeed) // 0 → still
    disposeMaterial(m)
  })

  it('injects the spectral sample into the fragment shader at the fresnel-safe point', () => {
    const m = materialFor(opal())
    const shader = compile(m)
    // The ramp is sampled and mixed into the LIT albedo (diffuseColor), and it reads the
    // built-in view-space normal — i.e. the injection actually reached the program.
    expect(shader.fragmentShader).toContain('uRamp')
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(')
    expect(shader.fragmentShader).toContain('vViewPosition')
    // The injection PRESERVES the original include (three still needs it) and appends the opal
    // block right after it — exactly the fresnel pattern.
    expect(shader.fragmentShader).toMatch(/#include <emissivemap_fragment>[\s\S]*diffuseColor\.rgb = mix\(/)
    disposeMaterial(m)
  })
})

describe('opalescent glossy finish (physical coat + reflection)', () => {
  it('builds on MeshPhysicalMaterial so a clearcoat is available', () => {
    const m = materialFor(opal())
    expect((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial).toBe(true)
    disposeMaterial(m)
  })

  it('applies clearcoat / coat roughness / reflection intensity from the doc', () => {
    const m = materialFor(opal({ clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 2.5 })) as THREE.MeshPhysicalMaterial
    expect(m.clearcoat).toBe(0.8)
    expect(m.clearcoatRoughness).toBe(0.15)
    expect(m.envMapIntensity).toBe(2.5)
    disposeMaterial(m)
  })

  it('defaults to a matte coat (clearcoat 0) so old opals render unchanged', () => {
    const m = materialFor(opal()) as THREE.MeshPhysicalMaterial
    expect(m.clearcoat).toBe(MATERIAL_DEFAULTS.clearcoat) // 0
    disposeMaterial(m)
  })

  it('updates the coat/reflection in place', () => {
    const m = materialFor(opal({ clearcoat: 0 })) as THREE.MeshPhysicalMaterial
    const ok = updateMaterial(m, opal({ clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 3 }))
    expect(ok).toBe(true)
    expect(m.clearcoat).toBe(1)
    expect(m.clearcoatRoughness).toBe(0.05)
    expect(m.envMapIntensity).toBe(3)
    disposeMaterial(m)
  })

  it('still injects the spectral rainbow on the physical base', () => {
    const m = materialFor(opal({ clearcoat: 1 }))
    const shader = compile(m)
    expect(shader.fragmentShader).toContain('diffuseColor.rgb = mix(')
    disposeMaterial(m)
  })
})

describe('opalescent spectrum default', () => {
  it('falls back to the vivid cyclic default, NOT the grey color→gradientB pair', () => {
    const stops = opalStopsOf({ type: 'opalescent', color: '#9aa3af', roughness: 0.6, metalness: 0 })
    expect(stops).toBe(OPAL_DEFAULT_STOPS)
    expect(stops.length).toBeGreaterThanOrEqual(6)
    // Cyclic: first == last so the shader's fract() wrap has no seam.
    expect(stops[0]!.color).toBe(stops[stops.length - 1]!.color)
    // Actually vivid: at least one stop is strongly saturated (not a grey).
    const hex = stops[0]!.color.replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(80)
  })

  it('authored stops win over the default', () => {
    const authored = [{ pos: 0, color: '#111111' }, { pos: 1, color: '#222222' }]
    expect(opalStopsOf({ type: 'opalescent', color: '#000', roughness: 1, metalness: 0, gradientStops: authored })).toBe(authored)
  })
})

describe('opalescent material — update in place', () => {
  it('mutates steering uniforms without a rebuild', () => {
    const m = materialFor(opal({ opalFrequency: 2 }))
    const ok = updateMaterial(m, opal({ opalFrequency: 4, opalHueShift: 90 }))
    expect(ok).toBe(true)
    const u = m.userData.opalUniforms as Record<string, { value: number }>
    expect(u.uFrequency.value).toBe(4)
    expect(u.uHueShift.value).toBeCloseTo(0.25)
    disposeMaterial(m)
  })

  it('rebuilds the ramp LUT ONLY when the stops move (an unrelated knob leaves it intact)', () => {
    const m = materialFor(opal())
    const u = m.userData.opalUniforms as Record<string, { value: THREE.DataTexture }>
    const rampBefore = u.uRamp.value

    // Changing frequency alone must NOT swap the ramp texture (the correlation guard: unrelated
    // knob → ramp identity stable).
    updateMaterial(m, opal({ opalFrequency: 4 }))
    expect(u.uRamp.value).toBe(rampBefore)

    // Changing the stops MUST swap it.
    updateMaterial(m, opal({ gradientStops: [{ pos: 0, color: '#00ff00' }, { pos: 1, color: '#ffff00' }] }))
    expect(u.uRamp.value).not.toBe(rampBefore)
    disposeMaterial(m)
  })
})

describe('opalescent material — time feed', () => {
  it('refreshOpalTime writes elapsed seconds into every live opal material', () => {
    const m = materialFor(opal({ opalFlowSpeed: 1 }))
    const u = m.userData.opalUniforms as Record<string, { value: number }>
    expect(u.uOpalTime.value).toBe(0)
    refreshOpalTime(12.5)
    expect(u.uOpalTime.value).toBe(12.5)
    disposeMaterial(m)
  })

  it('a disposed opal material is dropped from the time feed', () => {
    const m = materialFor(opal({ opalFlowSpeed: 1 }))
    const u = m.userData.opalUniforms as Record<string, { value: number }>
    disposeMaterial(m)
    refreshOpalTime(99)
    expect(u.uOpalTime.value).not.toBe(99) // no longer walked
  })
})
