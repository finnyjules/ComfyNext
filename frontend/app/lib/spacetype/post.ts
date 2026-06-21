import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

/**
 * Shared post-processing for the whole Space Type suite. A Three EffectComposer wraps the engine's
 * render: RenderPass → UnrealBloomPass (glow) → a combined GRADE pass (bokeh blur + chromatic
 * aberration + colour adjust). Because the final pass writes the canvas, post applies to BOTH the
 * live preview and exports (bake just reads the canvas). When everything is off the engine bypasses
 * this entirely (see postEnabled), so there's zero overhead and byte-identical output.
 */
export interface PostSettings {
  bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number
  color: boolean; exposure: number; contrast: number; saturation: number; hue: number
  chroma: boolean; chromaAmount: number
  blur: boolean; blurAmount: number
}

export const DEFAULT_POST: PostSettings = {
  bloom: false, bloomStrength: 0.6, bloomRadius: 0.4, bloomThreshold: 0.8,
  color: false, exposure: 1, contrast: 1, saturation: 1, hue: 0,
  chroma: false, chromaAmount: 0.25,
  blur: false, blurAmount: 0.01,
}

/** True when ANY post effect is on — the engine renders through the composer only then. */
export function postEnabled(p: PostSettings): boolean {
  return !!(p.bloom || p.color || p.chroma || p.blur)
}

// Bokeh blur (16-tap golden-angle disc) + radial chromatic aberration + colour grade, in one pass.
const GRADE_FRAG = [
  'uniform sampler2D tDiffuse;',
  'uniform vec2 uResolution;',
  'uniform float uBlur; uniform float uChroma;',
  'uniform float uExposure; uniform float uContrast; uniform float uSaturation; uniform float uHue;',
  'varying vec2 vUv;',
  // Radial RGB split: sample R outward, B inward, scaled by distance from centre.
  'vec4 sampleCA(vec2 uv){',
  '  vec2 dir = uv - 0.5;',
  '  vec2 off = uChroma * length(dir) * dir;',
  '  float r = texture2D(tDiffuse, uv + off).r;',
  '  vec4 g = texture2D(tDiffuse, uv);',
  '  float b = texture2D(tDiffuse, uv - off).b;',
  '  return vec4(r, g.g, b, g.a);',
  '}',
  'mat3 hueRot(float a){',
  '  float c = cos(a), s = sin(a);',
  '  return mat3(0.299,0.299,0.299, 0.587,0.587,0.587, 0.114,0.114,0.114)',
  '    + c*mat3(0.701,-0.299,-0.299, -0.587,0.413,-0.587, -0.114,-0.114,0.886)',
  '    + s*mat3(0.168,-0.328,1.250, 0.330,0.035,-1.050, -0.497,0.292,-0.203);',
  '}',
  'void main(){',
  '  vec4 src;',
  '  if (uBlur < 0.001) {',
  '    src = sampleCA(vUv);',
  '  } else {',
  '    vec4 acc = vec4(0.0);',
  '    const int N = 16;',
  '    float aspect = uResolution.x / uResolution.y;',  // circular bokeh in screen space
  '    for (int i = 0; i < N; i++) {',
  '      float t = (float(i) + 0.5) / float(N);',
  '      float ang = float(i) * 2.39996323;',           // golden angle
  '      vec2 tap = vUv + vec2(cos(ang), sin(ang) * aspect) * sqrt(t) * uBlur;',
  '      acc += sampleCA(tap);',
  '    }',
  '    src = acc / float(N);',
  '  }',
  '  vec3 col = src.rgb * uExposure;',
  '  col = (col - 0.5) * uContrast + 0.5;',              // contrast around mid-grey
  '  float l = dot(col, vec3(0.299, 0.587, 0.114));',
  '  col = mix(vec3(l), col, uSaturation);',             // saturation
  '  col = hueRot(uHue) * col;',                         // hue rotate (luma-preserving)
  '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), src.a);',
  '}',
].join('\n')

const GRADE_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

export class PostChain {
  readonly composer: EffectComposer
  private renderPass: RenderPass
  private bloomPass: UnrealBloomPass
  private gradePass: ShaderPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.composer = new EffectComposer(renderer)
    this.composer.setSize(width, height)
    this.renderPass = new RenderPass(scene, camera)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.6, 0.4, 0.8)
    this.gradePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(width, height) },
        uBlur: { value: 0 }, uChroma: { value: 0 },
        uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 }, uHue: { value: 0 },
      },
      vertexShader: GRADE_VERT,
      fragmentShader: GRADE_FRAG,
    })
    this.composer.addPass(this.renderPass)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(this.gradePass)
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height)
    this.bloomPass.setSize(width, height)
    ;(this.gradePass.uniforms.uResolution!.value as THREE.Vector2).set(width, height)
  }

  setSettings(p: PostSettings): void {
    this.bloomPass.enabled = p.bloom
    this.bloomPass.strength = p.bloomStrength
    this.bloomPass.radius = p.bloomRadius
    this.bloomPass.threshold = p.bloomThreshold
    const grade = p.color || p.chroma || p.blur
    this.gradePass.enabled = grade
    const u = this.gradePass.uniforms
    u.uBlur!.value = p.blur ? Math.max(0, p.blurAmount) : 0
    u.uChroma!.value = p.chroma ? p.chromaAmount : 0
    u.uExposure!.value = p.color ? p.exposure : 1
    u.uContrast!.value = p.color ? p.contrast : 1
    u.uSaturation!.value = p.color ? p.saturation : 1
    u.uHue!.value = p.color ? p.hue : 0
    // The composer needs a non-bloom pass to end on screen; gradePass is always the last pass, so
    // force it on (neutral) when only bloom is active so bloom still composites to the canvas.
    if (!grade && p.bloom) this.gradePass.enabled = true
  }

  /** Point the render pass at the current scene/camera (camera swaps per frame) and render. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene
    this.renderPass.camera = camera
    this.composer.render()
  }

  dispose(): void {
    this.composer.dispose()
    this.bloomPass.dispose()
  }
}
