// The shared post-processing chain. See `applyPost`'s doc comment below for the
// full contract; the short version: any studio hands its finished frame in,
// gets back a canvas, and draws that canvas onto its own immediately.
//
// Model is frontend/app/lib/shaderfx/renderer.ts (read that first) — one
// singleton WebGL2 context, ping-pong FBOs, the same y-flip convention (base
// upload flips, final blit doesn't). This module intentionally does NOT reuse
// that class: it has no need for shaderfx's composite/snapshot/layer-source
// machinery (this is a single linear chain, not a stacked-layer editor), so a
// smaller purpose-built runner is clearer than threading unused features
// through a shared one.
//
// Alpha (read before touching this file): the shared shader_effects/ catalog
// was written for opaque previews, so most of its frags hard-code output alpha
// to 1.0 (see e.g. bloom.frag, vignette.frag, duotone.frag). Editing every one
// of those to propagate alpha would be a wide, high-blast-radius change to
// files this task doesn't own. Instead, this chain keeps its own untouched
// copy of the ORIGINAL frame's alpha (`origTex`) and, after every enabled
// effect's own pass(es) finish, force-restores the running image's alpha
// channel back to that original — see the alpha-restore step inline in
// `render()`, right after each effect's pass loop. Two
// consequences: (a) transparent stays transparent no matter which combination
// of catalog frags is enabled, since none of them ever gets the last word on
// alpha; (b) `post_grain`'s own alpha gate (which reads ITS input's alpha,
// i.e. `u_image0.a`) always sees the true value, because every effect ahead of
// grain in POST_CHAIN_ORDER has already had its alpha corrected before grain
// runs.
import type { PostSettings } from './settings'
import { POST_EFFECTS, POST_CHAIN_ORDER, type PostEffectDef } from './manifest'
import { hexVec3 } from '~/lib/shaderfx/params'

// Catalog fragment sources, bundled at build time and keyed by effect id (e.g.
// "bloom" from shader_effects/bloom.frag → FRAG_SOURCES['bloom']). This is a
// static import, not a fetch — the post chain never depends on the backend
// catalog endpoint at render time. shader_effects/ sits outside frontend/, so
// nuxt.config.ts's vite.server.fs.allow grants Vite's dev server read access.
const FRAG_MODULES = import.meta.glob('../../../../../shader_effects/*.frag', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const FRAG_SOURCES: Record<string, string> = {}
for (const [path, source] of Object.entries(FRAG_MODULES)) {
  const id = path.slice(path.lastIndexOf('/') + 1, -'.frag'.length)
  FRAG_SOURCES[id] = source
}

function fragSource(id: string): string {
  const src = FRAG_SOURCES[id]
  if (!src) throw new Error(`post chain: shader_effects/${id}.frag not found in the bundle`)
  return src
}

/**
 * Effects whose catalog frag needs more than one ping-pong GL draw to do its
 * job — mirrors shader_effects/manifest.json's own "passes" field for exactly
 * these two ids (bloom: bright-pass → H-blur → V-blur → composite;
 * gaussian_blur: separable H then V). Every other effect in POST_CHAIN_ORDER
 * is single-pass. A small local map beats importing manifest.json wholesale
 * for two numbers.
 */
const MULTI_PASS: Record<string, number> = { bloom: 4, gaussian_blur: 2 }
function passCountFor(fragId: string): number {
  return MULTI_PASS[fragId] ?? 1
}

/** Filters POST_EFFECTS to enabled, non-withheld effects, sorted into
 *  POST_CHAIN_ORDER regardless of the order they were switched on or declared. */
export function activePasses(post: PostSettings, opts: { threeD?: boolean } = {}): PostEffectDef[] {
  const orderIndex = new Map(POST_CHAIN_ORDER.map((id, i) => [id, i]))
  return POST_EFFECTS
    .filter(e => !(e.threeDOnly && !opts.threeD) && !!post[e.enableKey])
    .sort((a, b) => (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0))
}

const VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

// Straight copy — used both to snapshot an effect's input into u_source and for
// the final draw to the visible canvas. No Y-flip (see the module header note
// above and shaderfx/renderer.ts's BLIT_FS comment for why).
const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() { fragColor0 = texture(u_image0, v_texCoord); }`

// Recombine: this effect's graded colour with the ORIGINAL frame's alpha. See
// the module header for why every effect's output alpha gets force-restored.
const ALPHA_RESTORE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_color;
uniform sampler2D u_alpha;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
void main() {
  vec3 c = texture(u_color, v_texCoord).rgb;
  float a = texture(u_alpha, v_texCoord).a;
  fragColor0 = vec4(c, a);
}`

function makeTargetTexture(gl: WebGL2RenderingContext, width: number, height: number): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo }
}

/**
 * ONE GL2 context app-wide (browsers cap at ~8-16), same posture as
 * shaderfx/renderer.ts: a private class plus a module-level singleton instance.
 */
class PostChainRunner {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private programs = new Map<string, { source: string; prog: WebGLProgram }>()
  private blit: WebGLProgram | null = null
  private alphaRestore: WebGLProgram | null = null
  private fboTex: (WebGLTexture | null)[] = [null, null]
  private fbos: (WebGLFramebuffer | null)[] = [null, null]
  // Snapshot of the CURRENT effect's input, captured before its own pass(es)
  // run — only bloom.frag reads it (as u_source, for its final "orig + glow"
  // composite), but binding it unconditionally for every effect is cheap and
  // matches shaderfx/renderer.ts's own unconditional u_source bind.
  private sourceTex: WebGLTexture | null = null
  private sourceFbo: WebGLFramebuffer | null = null
  private fboSize: [number, number] = [0, 0]
  // The untouched original frame — sampled only for its alpha channel, never
  // rendered into, so it needs no FBO of its own.
  private origTex: WebGLTexture | null = null

  private ensure(width: number, height: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!this.gl) throw new Error('WebGL2 unavailable')
    }
    const gl = this.gl
    if (this.canvas!.width !== width || this.canvas!.height !== height) {
      this.canvas!.width = width
      this.canvas!.height = height
    }
    if (this.fboSize[0] !== width || this.fboSize[1] !== height) {
      for (let i = 0; i < 2; i++) {
        if (this.fboTex[i]) gl.deleteTexture(this.fboTex[i] ?? null)
        if (this.fbos[i]) gl.deleteFramebuffer(this.fbos[i] ?? null)
        const t = makeTargetTexture(gl, width, height)
        this.fboTex[i] = t.tex
        this.fbos[i] = t.fbo
      }
      if (this.sourceTex) gl.deleteTexture(this.sourceTex)
      if (this.sourceFbo) gl.deleteFramebuffer(this.sourceFbo)
      const s = makeTargetTexture(gl, width, height)
      this.sourceTex = s.tex
      this.sourceFbo = s.fbo
      this.fboSize = [width, height]
    }
    return gl
  }

  private program(id: string, source: string): WebGLProgram {
    const gl = this.gl!
    const cached = this.programs.get(id)
    if (cached) {
      if (cached.source === source) return cached.prog
      gl.deleteProgram(cached.prog)
      this.programs.delete(id)
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s)
        gl.deleteShader(s)
        throw new Error(`post chain compile (${id}): ${log}`)
      }
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, source))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`post chain link (${id}): ${gl.getProgramInfoLog(prog)}`)
    this.programs.set(id, { source, prog })
    return prog
  }

  private uploadOrig(src: TexImageSource): void {
    const gl = this.gl!
    if (!this.origTex) this.origTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.origTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private blitTo(target: WebGLFramebuffer | null, colorTex: WebGLTexture, width: number, height: number): void {
    const gl = this.gl!
    if (!this.blit) this.blit = this.program('__blit__', BLIT_FS)
    gl.useProgram(this.blit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.BLEND)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, colorTex)
    const loc = gl.getUniformLocation(this.blit, 'u_image0')
    if (loc) gl.uniform1i(loc, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  render(passes: PostEffectDef[], post: PostSettings, base: TexImageSource, width: number, height: number, t: number): HTMLCanvasElement {
    const gl = this.ensure(width, height)
    this.uploadOrig(base)

    let readTex = this.origTex!
    let pingIdx = 0

    for (const effect of passes) {
      // gtao has no frag — ambient occlusion renders from depth+normal buffers
      // in three's EffectComposer, not through this 2D chain. It still counts
      // as an "active pass" for activePasses()'s contract; there is just
      // nothing for applyPost to draw.
      if (!effect.frag) continue

      // Snapshot this effect's input as its u_source, before its own pass(es)
      // touch readTex.
      this.blitTo(this.sourceFbo, readTex, width, height)
      const sourceTexForEffect = this.sourceTex!

      const fragId = effect.frag
      const prog = this.program(fragId, fragSource(fragId))
      const n = passCountFor(fragId)

      for (let k = 0; k < n; k++) {
        gl.useProgram(prog)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[pingIdx % 2] ?? null)
        gl.viewport(0, 0, width, height)
        gl.disable(gl.BLEND)

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, readTex)
        let loc = gl.getUniformLocation(prog, 'u_image0')
        if (loc) gl.uniform1i(loc, 0)

        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, sourceTexForEffect)
        loc = gl.getUniformLocation(prog, 'u_source')
        if (loc) gl.uniform1i(loc, 1)

        loc = gl.getUniformLocation(prog, 'u_resolution')
        if (loc) gl.uniform2f(loc, width, height)
        loc = gl.getUniformLocation(prog, 'u_time')
        if (loc) gl.uniform1f(loc, t)
        loc = gl.getUniformLocation(prog, 'u_pass')
        if (loc) gl.uniform1f(loc, k)
        loc = gl.getUniformLocation(prog, 'u_passCount')
        if (loc) gl.uniform1f(loc, n)
        if (effect.alphaGated) {
          loc = gl.getUniformLocation(prog, 'u_alphaGate')
          if (loc) gl.uniform1f(loc, 1.0)
        }

        for (const p of effect.params) {
          if (!p.uniform) continue
          const raw = post[p.settingsKey]
          const pLoc = gl.getUniformLocation(prog, p.uniform)
          if (!pLoc) continue
          if (p.kind === 'color') {
            const [r, g, b] = hexVec3(raw as string)
            gl.uniform3f(pLoc, r, g, b)
          } else {
            const v = p.toUniform ? p.toUniform(raw as number) : (raw as number)
            gl.uniform1f(pLoc, v)
          }
        }

        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        readTex = this.fboTex[pingIdx % 2]!
        pingIdx++
      }

      // Force this effect's output alpha back to the original frame's alpha —
      // see the module header. Every effect gets this, not just alphaGated
      // ones: alphaGated only controls whether the effect's OWN contribution is
      // gated by alpha (post_grain not painting onto transparent background);
      // this restore is what keeps alpha itself intact end to end.
      if (!this.alphaRestore) this.alphaRestore = this.program('__alphaRestore__', ALPHA_RESTORE_FS)
      gl.useProgram(this.alphaRestore)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[pingIdx % 2] ?? null)
      gl.viewport(0, 0, width, height)
      gl.disable(gl.BLEND)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, readTex)
      let rLoc = gl.getUniformLocation(this.alphaRestore, 'u_color')
      if (rLoc) gl.uniform1i(rLoc, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.origTex)
      rLoc = gl.getUniformLocation(this.alphaRestore, 'u_alpha')
      if (rLoc) gl.uniform1i(rLoc, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      readTex = this.fboTex[pingIdx % 2]!
      pingIdx++
    }

    // Final blit to the visible canvas — no flip (see module header / BLIT_FS).
    this.blitTo(null, readTex, width, height)
    return this.canvas!
  }
}

const postChain = new PostChainRunner()

/**
 * The shared post stage. Any studio hands its finished frame in and draws the
 * result back onto its own canvas.
 *
 * ONE GL2 context app-wide (browsers cap at ~8-16), same posture as
 * shaderfx/renderer.ts. Consequence, and the invariant to respect: the
 * returned canvas is valid ONLY until the next applyPost call. Draw it back
 * immediately. A studio that held the reference across a frame would silently
 * render another studio's output.
 *
 * Returns `source` untouched (and creates no context) when nothing is
 * enabled, so post-off costs nothing.
 *
 * Must stay free of `three` imports.
 */
export function applyPost(
  source: TexImageSource, post: PostSettings, w: number, h: number, t: number,
  opts: { threeD?: boolean } = {},
): TexImageSource {
  const passes = activePasses(post, opts)
  if (passes.length === 0) return source
  return postChain.render(passes, post, source, w, h, t)
}
