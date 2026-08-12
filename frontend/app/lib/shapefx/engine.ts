import * as THREE from 'three'
// StudioColor can emit 8-digit #rrggbbaa. THREE.Color has no alpha channel and renders
// 8-digit hex as WHITE (console warning, no throw), so picker colours are stripped to 6
// digits here — surfaces without transparency degrade to opaque rather than going white.
import { stripAlpha } from '~/lib/color/convert'
import { buildGeometry } from './geometry'
import { applyVertexColors, vertexRampT, rampHexes } from './color'
import { makeOmbreMaterial } from './ombre'
import { buildSurfaceTexture } from './surface'
import { withShaderFillContext, clearShaderFillOwner, refreshLiveShaderFills } from '~/lib/spacetype/fills'
import { hashSeed } from '~/lib/spacetype/rng'
import { postNeeded, POST_VERT, POST_FRAG } from './post'
import { registerWebGLContext, type WebGLContextHandle } from '~/lib/webgl/contextRegistry'
import type { ShapeConfig } from './config'
import { applyPost } from '~/lib/studio/post/chain'
import { DEFAULT_POST, postEnabled } from '~/lib/studio/post/settings'

// Straight pass-through fragment shader for blitPostResult()'s compositing quad —
// same role as Gradient/Texture's own BLIT_FS, but reused here as a THREE
// ShaderMaterial (see ensureBlit()'s doc for why). Shares POST_VERT (already
// imported above) rather than declaring a second identical vertex shader.
const BLIT_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
void main() { gl_FragColor = texture2D(uScene, vUv); }
`

/**
 * Sampling + pixel-interpretation settings for the shared post stack's blit
 * texture (see ensureBlit). EVERY property the byte-for-byte copy depends on is
 * set here explicitly, including the two that merely happen to match three's
 * current defaults:
 *  - `premultiplyAlpha = false`: applyPost's canvas holds STRAIGHT alpha (its GL
 *    context is created with premultipliedAlpha: false — see chain.ts). Letting
 *    three premultiply on upload would darken every partially-transparent pixel
 *    of a Shape export against black.
 *  - `colorSpace = NoColorSpace`: the post chain's output is already in the
 *    renderer's output space. Tagging it sRGB would make three insert a
 *    linearisation on sample, which BLIT_FRAG (a raw texture2D read, no colour
 *    chunks) does not undo — so the frame would come back lighter.
 * Both are three@0.171's defaults today, so this is not a fix; it stops a three
 * version bump from silently corrupting transparent/colour-managed Shape exports
 * with nothing in the suite to catch it. Pinned by shapefx-post-adoption.unit.spec.ts.
 */
export function configureBlitTexture(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.premultiplyAlpha = false
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

// Ortho frustum half-height chosen so a unit-ish shape frames nicely at z=6.
const ORTHO_HALF_H = 2.6
const CAM_Z = 6

/** Source of each engine's stable `id` — see ShapeEngine.id's doc. Separate counter from
 *  SpaceTypeEngine's (different id namespace/prefix), so the two can never collide even
 *  though they share fills.ts's owner-scoped shader field cache. */
let _nextShapeEngineId = 1

export class ShapeEngine {
  readonly renderer: THREE.WebGLRenderer
  private readonly ctxHandle: WebGLContextHandle
  readonly scene: THREE.Scene
  /** Stable per-instance id, never reused — scopes this engine's shader fills in fills.ts's
   *  owner-scoped cache (see SpaceTypeEngine.id's doc in ../spacetype/engine.ts for the full
   *  rationale; identical mechanism, shared cache, distinct id namespace). */
  readonly id: string = `shape${_nextShapeEngineId++}`
  private perspCam: THREE.PerspectiveCamera
  private orthoCam: THREE.OrthographicCamera
  private mesh: THREE.Mesh | null = null
  private config: ShapeConfig | null = null
  private w: number
  private h: number
  private _frozenFieldCount = 0
  /** True while this engine is producing FINAL export output (a bake) rather than an
   *  interactive live preview — threaded into `withShaderFillContext`/`refreshLiveShaderFills`
   *  so a shader fill renders unclamped at the engine's actual output size instead of the
   *  live-preview clamp (mirrors SpaceTypeEngine.setBake; see field.ts's preview/bake split).
   *  Before this existed, `setConfig`/`refreshShaderFields` hardcoded `bake: false`
   *  unconditionally, so NO Shape Studio export path could ever request an unclamped field —
   *  wire this via `setBake(true)` around a bake render, `setBake(false)` after. */
  private _bake = false
  setBake(bake: boolean): void { this._bake = bake }
  // Lazily-built post-processing pass (distortion; grain retired to the shared post
  // stack in Task 8) — see ensurePost(). Only allocated the first time a config
  // actually needs it (postNeeded), so a shape that needs neither distortion nor the
  // legacy render-path pin never pays for a render target or a second draw call.
  private rt: THREE.WebGLRenderTarget | null = null
  private postScene: THREE.Scene | null = null
  private postCam: THREE.OrthographicCamera | null = null
  private postMat: THREE.ShaderMaterial | null = null
  // Compositing quad for the SHARED post stack's result (Task 7) — see ensureBlit()'s
  // doc comment for why this exists instead of a raw-GL blit like Gradient/Texture's.
  private blitScene: THREE.Scene | null = null
  private blitCam: THREE.OrthographicCamera | null = null
  private blitMat: THREE.ShaderMaterial | null = null
  private blitTex: THREE.CanvasTexture | null = null
  /** Non-zero when one or more shader-fill fields exceeded LIVE_FIELD_CEILING on the last
   *  refreshShaderFields() call and are showing a frozen (t=0) snapshot instead of animating.
   *  Mirrors SpaceTypeEngine.frozenFieldCount — same "no silent caps" design rule applies to
   *  every surface, not just Space Type. */
  get frozenFieldCount(): number { return this._frozenFieldCount }

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.w = width; this.h = height
    // preserveDrawingBuffer:true so frameToBlob can read pixels after render.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(width, height, false)
    this.renderer.setPixelRatio(1)
    this.scene = new THREE.Scene()
    this.perspCam = new THREE.PerspectiveCamera(45, width / height, 0.1, 100)
    this.perspCam.position.set(0, 0, CAM_Z)
    const a = width / height
    this.orthoCam = new THREE.OrthographicCamera(-ORTHO_HALF_H * a, ORTHO_HALF_H * a, ORTHO_HALF_H, -ORTHO_HALF_H, 0.1, 100)
    this.orthoCam.position.set(0, 0, CAM_Z)
    this.orthoCam.lookAt(0, 0, 0)
    this.ctxHandle = registerWebGLContext('Shape')
  }

  private get cam(): THREE.Camera {
    return this.config?.shape.projection === 'perspective' ? this.perspCam : this.orthoCam
  }

  setSize(width: number, height: number): void {
    this.w = width; this.h = height
    this.renderer.setSize(width, height, false)
    const a = width / height
    this.perspCam.aspect = a; this.perspCam.updateProjectionMatrix()
    this.orthoCam.left = -ORTHO_HALF_H * a; this.orthoCam.right = ORTHO_HALF_H * a
    this.orthoCam.updateProjectionMatrix()
    this.rt?.setSize(width, height)
  }

  /** Lazily build the fullscreen-quad post pass (render target + ortho cam + shader
   *  material) the first time a config actually needs it. RGBAFormat (three's default) is
   *  required so transparent renders survive the round-trip — do not narrow to RGBFormat. */
  private ensurePost(): void {
    if (this.rt) return
    this.rt = new THREE.WebGLRenderTarget(this.w, this.h)
    this.postScene = new THREE.Scene()
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.postMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      // Direct overwrite of the destination buffer — the shader computes the final RGBA
      // (including alpha) itself, so GPU blending must stay off or fractional-alpha edge
      // pixels would get blended against the framebuffer instead of written straight.
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uScene: { value: null },
        uDistort: { value: 0 },
        uResolution: { value: new THREE.Vector2(this.w, this.h) },
        uSeed: { value: 0 },
      },
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.postMat)
    this.postScene.add(quad)
  }

  /**
   * Lazily build the compositing quad that draws the SHARED post stack's result
   * (Task 7) onto this engine's own canvas.
   *
   * WHY NOT A RAW GL BLIT, unlike Gradient/Texture's `blitBack`: this.canvas is
   * owned by THREE.WebGLRenderer, which caches its own GL state (bound program,
   * textures, buffers — see three's WebGLState) to skip redundant driver calls
   * across frames. Gradient/Texture blit by reaching into their OWN self-owned
   * raw WebGL2 context (gl.useProgram/gl.bindTexture/gl.drawArrays directly) —
   * safe there because nothing else touches that context. Doing the same against
   * `this.renderer.getContext()` here would issue GL calls three doesn't know
   * about: three's cache would still believe its own last-bound program/texture
   * are active, so the NEXT `renderer.render()` call (next frame, or the next
   * `drawFrame()` inside the same frame for a resize/bake) could skip state
   * changes it actually needs, corrupting a LATER draw in a way that wouldn't
   * show up as an obvious one-frame glitch.
   *
   * Instead, this composites through three's OWN render path: a full-screen quad
   * (same PlaneGeometry(2,2) + orthographic camera shape as ensurePost()'s own
   * distortion quad above), textured with applyPost()'s result canvas
   * wrapped in a THREE.CanvasTexture, drawn via `this.renderer.render(...)`.
   * Three issues every GL call itself, so its state cache stays authoritative —
   * this is the same posture as three's own documented pattern for compositing
   * an external canvas/texture into a scene (e.g. video textures), not a new
   * mechanism invented for this task.
   *
   * The fragment shader is a raw, uncorrected `texture2D` sample (BLIT_FRAG) —
   * deliberately a plain ShaderMaterial, not MeshBasicMaterial, so nothing in
   * three's built-in material shader chunks (tone mapping, colour-space
   * conversion) touches the pixels; this is a byte-for-byte copy, matching
   * Gradient/Texture's own straight pass-through blit.
   */
  private ensureBlit(): void {
    if (this.blitScene) return
    this.blitScene = new THREE.Scene()
    this.blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    // Placeholder image, swapped every call in blitPostResult() before the draw —
    // CanvasTexture needs a real canvas at construction.
    this.blitTex = new THREE.CanvasTexture(document.createElement('canvas'))
    configureBlitTexture(this.blitTex)
    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      // Full-screen overwrite of the destination buffer, same requirement (and
      // same reason) as ensurePost()'s postMat above: applyPost()'s result
      // already carries its own final alpha, so GPU blending must stay off or
      // fractional-alpha edge pixels would blend against whatever the canvas
      // held before this draw instead of being written straight.
      blending: THREE.NoBlending,
      uniforms: { uScene: { value: this.blitTex } },
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat)
    this.blitScene.add(quad)
  }

  /** Draw `src` (applyPost()'s returned canvas) onto this engine's own canvas — see
   *  ensureBlit()'s doc for why this goes through three's render path rather than a
   *  raw GL blit. `src` is valid only until the NEXT applyPost() call from ANY
   *  studio (one shared GL2 context app-wide — see chain.ts's module header), so
   *  this must run immediately after applyPost() returns it, which drawFrame() does. */
  private blitPostResult(src: TexImageSource): void {
    this.ensureBlit()
    this.blitTex!.image = src
    this.blitTex!.needsUpdate = true
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.blitScene!, this.blitCam!)
  }

  /** The one call site that draws the 3D scene — used both for the direct-to-canvas skip
   *  path and for rendering into the offscreen target ahead of the post pass, so there is
   *  exactly one `renderer.render(scene, cam)` call in this file. */
  private renderScene(): void {
    this.renderer.render(this.scene, this.cam)
  }

  /** The single place the scene reaches pixels. `render()` and `frameToBlob()` both call
   *  this, so the preview and every bake apply exactly the same post chain — INCLUDING
   *  the shared post stack appended at the end (Task 7): the SAME guarantee Gradient's
   *  own single call site documents (see gradientfx/renderer.ts's render()). */
  private drawFrame(): void {
    const cfg = this.config
    if (!cfg || !postNeeded(cfg)) {
      this.renderer.setRenderTarget(null)
      this.renderScene()
    } else {
      this.ensurePost()
      this.renderer.setRenderTarget(this.rt)
      this.renderer.clear()
      this.renderScene()
      this.renderer.setRenderTarget(null)
      const u = this.postMat!.uniforms
      u.uScene!.value = this.rt!.texture
      u.uDistort!.value = (cfg.style.distortion ?? 0) / 100
      u.uResolution!.value.set(this.w, this.h)
      // Stable per-shape seed (derived from the config's seed string) so the distortion
      // field doesn't jump between renders/bakes of the same shape. The shared post
      // stack's grain is pinned to this SAME value below — see the applyPost call.
      u.uSeed!.value = hashSeed(cfg.seed) % 1000
      this.renderer.render(this.postScene!, this.postCam!)
    }

    // Shared post-processing stack (Task 7) — runs AFTER Shape's own distortion pass
    // above (POST_FRAG; its grain half was retired in Task 8 — see post.ts's
    // postNeeded and config.ts's mergeConfig), at the TRUE end of the frame: this.
    // renderer.domElement already holds the fully-composed frame from whichever
    // branch ran, so applyPost sees exactly what a viewer sees.
    const post = cfg?.post ?? DEFAULT_POST
    if (postEnabled(post)) {
      // t=0: Shape Studio has no timeline/motion track of its own (unlike Gradient,
      // which threads a real elapsed-seconds `time` into applyPost) — render()'s
      // orbit argument is camera-only, and refreshShaderFields' own doc above notes
      // Shape has no loop-duration concept at all. A time-varying post effect
      // (film/glitch) therefore renders its t=0 frame — static, matching every
      // other static aspect of a Shape render.
      //
      // seed: Shape's config carries its own seed string (cfg.seed) the same way
      // Gradient's does — hashed with the SAME hashSeed() this file already uses
      // for POST_FRAG's own uSeed uniform above, so post_grain's noise field
      // re-rolls per-shape, not identically across every Shape node.
      //
      // `% 1000` is a FIDELITY PIN, not a precision guard (applyPost owns that now —
      // see safeSeed/SEED_MAX in studio/post/chain.ts, which would fold this seed
      // anyway). It reproduces the exact value the retired uGrain grain in POST_FRAG
      // was sampled with (line ~237 above, `hashSeed(cfg.seed) % 1000`), so a
      // migrated document gets back the identical noise field rather than a
      // statistically-equivalent but differently-phased one. Changing it re-rolls
      // every existing shape's grain.
      const out = applyPost(this.renderer.domElement, post, this.w, this.h, 0, {
        threeD: false,
        seed: cfg ? hashSeed(cfg.seed) % 1000 : undefined,
      })
      if (out !== this.renderer.domElement) this.blitPostResult(out)
    }
  }

  private disposeMesh(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    const mat = this.mesh.material as THREE.Material & { map?: THREE.Texture | null }
    mat.map?.dispose()
    mat.dispose()
    this.mesh = null
  }

  /** Rebuild geometry + material for a config. Always unlit (MeshBasic or the ombré shader). */
  setConfig(config: ShapeConfig): void {
    this.config = config
    this.disposeMesh()
    const geo = buildGeometry(config)
    let mat: THREE.Material
    if (config.fillMode === 'facets') {
      if (config.palette.coloring === 'ombre') {
        // GPU dither path: per-vertex ramp position + a ShaderMaterial that speckles per pixel.
        geo.setAttribute('aT', new THREE.BufferAttribute(vertexRampT(geo, config), 1))
        mat = makeOmbreMaterial(rampHexes(config))
      } else {
        applyVertexColors(geo, config)
        mat = new THREE.MeshBasicMaterial({ vertexColors: true })
      }
    } else {
      // Scope any shader fill this resolves to THIS engine instance — see
      // SpaceTypeEngine.build()'s identical use of withShaderFillContext for the full
      // rationale. setConfig MUST stay synchronous (no `await` anywhere in this method or
      // buildSurfaceTexture) — withShaderFillContext's re-entrancy guard throws if two
      // builds ever overlap, which is exactly what an `async setConfig` would risk.
      const tex = withShaderFillContext(
        { ownerId: this.id, w: this.w, h: this.h, bake: this._bake },
        () => buildSurfaceTexture(config),
      )
      mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshBasicMaterial({ color: new THREE.Color(stripAlpha(config.fill.a)) })
    }
    this.mesh = new THREE.Mesh(geo, mat)
    this.scene.add(this.mesh)
    // background
    if (config.style.background === 'transparent') this.scene.background = null
    else this.scene.background = new THREE.Color(stripAlpha(config.style.background))
  }

  /** Advance this engine's live shader-fill field(s) to `elapsedSec` — wall-clock seconds
   *  since the surface mounted. Shape Studio has no timeline/loop-duration of its own (unlike
   *  SpaceTypeEngine, which derives shader time from t01 * loopDuration — see
   *  SpaceTypeEngine.renderFrameAt), so elapsed real time is the only clock available here.
   *  Call once per host frame, BEFORE render(), same contract as
   *  SpaceTypeEngine.renderFrameAt's refreshLiveShaderFills call.
   *
   *  Callers should only call this when the CURRENT config actually has a shader fill (see
   *  `configHasShaderFill` in ./surface) — not because this is unsafe to call otherwise (an
   *  owner with no cached fields is a cheap no-op inside refreshLiveShaderFills), but so a
   *  plain-fill Shape node's per-frame loop doesn't do new work it never did before.
   *
   *  `bake`/`w`/`h` (Important 5, final review): pass `bake: true` with the actual export
   *  resolution before a still export's readback (see exportPng in ShapeStudioSurface.vue) so
   *  the field renders unclamped at that size instead of the live-preview LIVE_FIELD_PX clamp.
   *  Default to `this._bake`/`this.w`/`this.h` (the prior, implicit behaviour) so every
   *  existing live-preview call site is unaffected. */
  refreshShaderFields(elapsedSec: number, bake = this._bake, w = this.w, h = this.h): void {
    this._frozenFieldCount = refreshLiveShaderFills(this.id, elapsedSec, 30, w, h, bake).frozenCount
  }

  render(orbit: { yaw: number; pitch: number; zoom: number }): void {
    if (this.mesh) {
      this.mesh.rotation.y = orbit.yaw
      this.mesh.rotation.x = orbit.pitch
      // Persisted uniform scale (config). Applied here so it survives mesh rebuilds and works
      // in orthographic mode, where moving the camera along z doesn't change apparent size.
      this.mesh.scale.setScalar(this.config?.shape.scale ?? 1)
    }
    const z = CAM_Z / Math.max(0.2, orbit.zoom)
    this.perspCam.position.z = z
    this.orthoCam.position.z = z
    this.drawFrame()
  }

  /** Render at an optional target size and read back a PNG blob, then restore the preview size. */
  async frameToBlob(w?: number, h?: number): Promise<Blob> {
    const ow = this.w, oh = this.h            // capture BEFORE setSize mutates this.w/this.h
    const tw = w ?? ow, th = h ?? oh
    const resized = (ow !== tw || oh !== th)
    if (resized) this.setSize(tw, th)
    this.drawFrame()
    const blob: Blob = await new Promise((res, rej) =>
      this.renderer.domElement.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
    if (resized) this.setSize(ow, oh)         // restore the true original preview size
    return blob
  }

  dispose(): void {
    this.disposeMesh()
    if (this.scene.background instanceof THREE.Color) this.scene.background = null
    clearShaderFillOwner(this.id)
    this.rt?.dispose()
    this.postScene?.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    this.postMat?.dispose()
    this.rt = null; this.postScene = null; this.postCam = null; this.postMat = null
    this.blitScene?.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
    })
    this.blitMat?.dispose()
    this.blitTex?.dispose()
    this.blitScene = null; this.blitCam = null; this.blitMat = null; this.blitTex = null
    // forceContextLoss() BEFORE dispose() frees the GL context slot immediately
    // rather than at GC — see the Scene3D engine's dispose for why this matters
    // against the browser's ~16-context cap. Guarded: throws if already lost.
    try { this.renderer.forceContextLoss() } catch { /* already lost */ }
    this.renderer.dispose()
    this.ctxHandle.release()
  }
}
