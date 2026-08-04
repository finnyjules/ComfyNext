import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling, fillAnchor, fillScreenVec } from '../fills'
import { defaultFillsFor } from '../palette'

/**
 * MELT — a readable word at the TOP and BOTTOM, with the letters between stretched into wavy
 * vertical strokes. A flat 2D plane samples the word texture per fragment:
 *   • top band  (v ∈ [1−anchor, 1])  → the word, upright (readable)
 *   • bottom band (v ∈ [0, anchor])  → the word, upright (readable)
 *   • middle band                    → the word's mid-row EXTRUDED vertically → vertical streaks
 * A horizontal "liquify" wave displaces u; its amplitude peaks in the middle (envelope 1 at
 * centre → 0 at the edges) so the anchors stay readable while the streaks wiggle. Colour comes
 * from the shared fills system (solid/gradient/grid/noise). The wave phase animates over the loop.
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SELECTED', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 1, step: 1, default: 1, group: 'Type' },
  // Melt shape.
  { key: 'anchor', label: 'Readable bands', kind: 'slider', min: 0.08, max: 0.45, step: 0.01, default: 0.22, group: 'Wave' },
  { key: 'cut', label: 'Cut point', kind: 'slider', min: 0.2, max: 0.8, step: 0.01, default: 0.5, group: 'Wave' },
  { key: 'streak', label: 'Streak spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1, group: 'Wave' },
  { key: 'waveAmount', label: 'Wave amount', kind: 'slider', min: 0, max: 0.3, step: 0.005, default: 0.06, group: 'Wave' },
  { key: 'waveCount', label: 'Wave count', kind: 'slider', min: 0.5, max: 16, step: 0.5, default: 5, group: 'Wave' },
  { key: 'colTwist', label: 'Column twist', kind: 'slider', min: 0, max: 8, step: 0.1, default: 1, group: 'Wave' },
  { key: 'waveVary', label: 'Wave variation', kind: 'slider', min: 0, max: 1.5, step: 0.05, default: 0.7, group: 'Wave' },
  // Smooth sine snake vs geometric stepped/glitch jogs (right-angle staircase displacement).
  { key: 'waveStyle', label: 'Wave style', kind: 'select', options: ['smooth', 'geometric'], default: 'smooth', group: 'Wave' },
  { key: 'steps', label: 'Geometric steps', kind: 'slider', min: 3, max: 40, step: 1, default: 12, group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1, default: 1, group: 'Motion' },
  // Colour — the word's fill (solid/gradient/grid/noise).
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'melt'), group: 'Color' },
  // Grit: roughen the edges with noise for a dirty / photocopied finish. 0 = clean.
  { key: 'grit', label: 'Grit', kind: 'slider', min: 0, max: 0.06, step: 0.002, default: 0.018, group: 'Color' },
  { key: 'gritScale', label: 'Grit scale', kind: 'slider', min: 10, max: 320, step: 5, default: 90, group: 'Color' },
  // Transform.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

function n(p: Params, k: string): number { return Number(p[k]) }

// Per-scene state lives on the built root's userData (see update()), NOT module vars: the card
// preview and the headless frame source run two concurrent engines over this singleton effect,
// and the engine caches multiple roots per instance — shared module vars would let whichever
// built last own them, freezing every other surface. `uTime` is the shader uniform ref and
// `speed` the (read-only per frame) loop rate; both are wrapped in one object mutated by update.
interface MeltState { uTime: { value: number }; speed: number }

export const meltEffect: SpaceTypeEffect = {
  id: 'melt',
  label: 'Melt',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()

    // CLAMP the word texture (it ships as RepeatWrapping for tiling effects). Without this, the
    // plane's right edge (u→1) wraps to the word's left edge → a ghost vertical line.
    textTexture.wrapS = textTexture.wrapT = three.ClampToEdgeWrapping
    textTexture.needsUpdate = true

    // Plane sized so the readable word (height = anchor·planeH) keeps the word's aspect.
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = img && img.width && img.height ? img.width / img.height : 4
    const anchor = Math.max(0.08, n(params, 'anchor'))
    const planeH = 14
    const planeW = Math.max(4, Math.min(26, anchor * planeH * texAspect))

    const fill = parseFills(params.fills)[0]!
    const fillTex = fillShaderTexture(three, fill)

    const uFillTex = { value: fillTex }
    const uFillTiling = { value: fillTiling(fill) }
    const uFillAnchor = { value: fillAnchor(fill) }
    const uFillScreen = { value: fillScreenVec(three) }
    const uAnchor = { value: anchor }
    const uCut = { value: n(params, 'cut') }
    const uStreak = { value: n(params, 'streak') }
    const uGrit = { value: n(params, 'grit') }
    const uGritScale = { value: n(params, 'gritScale') }
    const uAmp = { value: n(params, 'waveAmount') }
    const uWaveCount = { value: n(params, 'waveCount') }
    const uColTwist = { value: n(params, 'colTwist') }
    const uWaveVary = { value: n(params, 'waveVary') }
    const uGeo = { value: String(params.waveStyle) === 'geometric' ? 1 : 0 }
    const uSteps = { value: Math.max(2, n(params, 'steps')) }
    const uT = { value: 0 }
    const speed = Math.max(0, Math.round(n(params, 'speed')))

    const mat = new three.MeshBasicMaterial({ map: textTexture, transparent: true, depthWrite: false, side: three.DoubleSide })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFillTex = uFillTex
      shader.uniforms.uFillTiling = uFillTiling
      shader.uniforms.uFillAnchor = uFillAnchor
      shader.uniforms.uFillScreen = uFillScreen
      shader.uniforms.uAnchor = uAnchor
      shader.uniforms.uCut = uCut
      shader.uniforms.uStreak = uStreak
      shader.uniforms.uGrit = uGrit
      shader.uniforms.uGritScale = uGritScale
      shader.uniforms.uAmp = uAmp
      shader.uniforms.uWaveCount = uWaveCount
      shader.uniforms.uColTwist = uColTwist
      shader.uniforms.uWaveVary = uWaveVary
      shader.uniforms.uGeo = uGeo
      shader.uniforms.uSteps = uSteps
      shader.uniforms.uTime = uT
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRawUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'uniform sampler2D uFillTex; uniform float uFillTiling;',
          'uniform float uFillAnchor; uniform vec2 uFillScreen;',   // 0=object(glyph UV) 1=frame(screen space)
          'uniform float uAnchor; uniform float uCut; uniform float uStreak;',
          'uniform float uAmp; uniform float uWaveCount; uniform float uColTwist; uniform float uTime;',
          'uniform float uWaveVary; uniform float uGeo; uniform float uSteps; uniform float uGrit; uniform float uGritScale;',
          'varying vec2 vRawUv;',
          // Bounded text-alpha sample (outside the word → 0, no wrap). `map` is passed in because
          // its `uniform sampler2D map` is declared AFTER <common>, so we can't reference it here.
          'float meltA(sampler2D m, vec2 p){ if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0) return 0.0; return texture2D(m, p).a; }',
          // Value noise for a dirty / photocopied edge roughness.
          'float meltHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
          'float meltNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f); float a=meltHash(i); float b=meltHash(i+vec2(1.0,0.0)); float c=meltHash(i+vec2(0.0,1.0)); float d=meltHash(i+vec2(1.0,1.0)); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }',
        ].join('\n'))
        .replace('#include <map_fragment>', [
          'float TAU = 6.2831853;',
          'float midHi = 1.0 - uAnchor;',
          'float span = max(1e-3, midHi - uAnchor);',
          // mt scans the word from BOTTOM (0, at the top join) to TOP (1, at the bottom join) — so
          // the streaks start exactly where the top word ends and end where the bottom word starts.
          'float mt = clamp((midHi - vRawUv.y) / span, 0.0, 1.0);',
          'float inMid = step(uAnchor, vRawUv.y) * step(vRawUv.y, midHi);',
          // Wave envelope: 0 at the joins (clean connection + readable words) → 1 at the centre.
          'float env = inMid * sin(3.14159265 * mt);',
          // Per-column irregularity: random phase + amplitude per column (noise of x) so the
          // strokes don't all wiggle in the same smooth gradient.
          'float colN = meltNoise(vec2(vRawUv.x * (uColTwist + 1.0) * 2.0, 3.1));',
          'float phase = vRawUv.x * uColTwist * TAU + (colN - 0.5) * uWaveVary * TAU;',
          'float ampV = 1.0 + (meltNoise(vec2(vRawUv.x * (uColTwist + 1.0) * 2.0, 8.7)) - 0.5) * uWaveVary;',
          // Geometric mode: quantize y → displacement is constant within each band (vertical
          // stroke) and jumps at band edges (right-angle jog); quantize the amount → blocky levels.
          'float yWave = (uGeo > 0.5) ? floor(vRawUv.y * uSteps) / uSteps : vRawUv.y;',
          'float raw = sin(uWaveCount * TAU * yWave + phase + uTime);',
          'if (uGeo > 0.5) raw = floor(raw * 3.0 + 0.5) / 3.0;',
          'float wave = uAmp * env * ampV * raw;',
          // Grit: jitter the sample position with noise → rough, dirty edges (gx roughens the
          // vertical stroke sides, gy the horizontal cuts).
          'vec2 gn = vec2(meltNoise(vRawUv * uGritScale), meltNoise(vRawUv * uGritScale + 19.7)) - 0.5;',
          'float su = vRawUv.x + wave + gn.x * uGrit;',
          'float gy = gn.y * uGrit;',
          // ONE word sliced at uCut: a CONTINUOUS sv map (top half above cut, bottom half below,
          // cut line through the middle) + a smear that RAMPS to 0 at the joins (env) — so the
          // readable bands and the streaks meet with no coverage step (no seam line).
          'float sv0;',
          'if (vRawUv.y >= midHi) { sv0 = mix(uCut, 1.0, (vRawUv.y - midHi) / max(1e-3, uAnchor)); }',
          'else if (vRawUv.y <= uAnchor) { sv0 = mix(0.0, uCut, vRawUv.y / max(1e-3, uAnchor)); }',
          'else { sv0 = uCut; }',
          'float smearAmt = uStreak * env;',
          'float g = 0.0;',
          'for (int k = 0; k < 5; k++) {',
          '  float sv = sv0 + (float(k) - 2.0) * 0.05 * smearAmt + gy;',
          '  g = max(g, meltA(map, vec2(su, clamp(sv, 0.0, 1.0))));',
          '}',
          'vec2 fillUv = uFillAnchor > 0.5 ? gl_FragCoord.xy / uFillScreen : vRawUv * uFillTiling;',
          'vec3 fillRGB = texture2D(uFillTex, fillUv).rgb;',
          'diffuseColor = vec4(fillRGB, g);',
        ].join('\n'))
    }

    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), mat)
    mesh.userData.tex = textTexture
    root.add(mesh)

    root.userData.meltState = { uTime: uT, speed } satisfies MeltState
    meltEffect.update(0, params, root)
    return root
  },

  update(t01, _params, root) {
    const state = root?.userData?.meltState as MeltState | undefined
    if (!state) return
    // Seamless loop: integer wave cycles per loop.
    state.uTime.value = t01 * Math.PI * 2 * state.speed
  },
}
