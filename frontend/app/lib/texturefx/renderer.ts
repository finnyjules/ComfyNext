// Singleton WebGL2 renderer for Texture Studio. One GL context app-wide; callers
// drawImage() the returned canvas (preview) or toBlob() it (export). A single
// fragment shader synthesizes the whole tile from lattice + motif uniforms,
// mirroring the pure-TS patternColor / latticeCell math in pattern.ts exactly.

import type { Params } from '~/lib/spacetype/effect'
import { LATTICES, MOTIFS } from '~/lib/texturefx/types'

const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform float u_cells, u_lattice, u_motif, u_scale, u_lw, u_jitter, u_seed;
uniform vec3 u_a, u_b, u_bg;

float posmod(float a, float n){ return mod(mod(a,n)+n, n); }

// Deterministic 0..1 hash of a float cell index. Uses a multiply chain that is
// a float reimplementation of the intent of pattern.ts's hash1 (XOR-shift on
// integers). Exact bit-equality is not required — both produce a deterministic
// value per (cx, cy, seed) triple. Only the modded cx/cy are ever hashed, so
// seamlessness is guaranteed across tile boundaries.
float hash1(float i){
  float x = i*374761393.0 + 668265263.0;
  x = mod(x, 2147483647.0);
  x = mod((x*1274126177.0), 2147483647.0);
  return fract(x/2147483647.0);
}

void main(){
  float cells = max(2.0, floor(u_cells + 0.5));
  float gx = v_uv.x * cells;
  float gy = v_uv.y * cells;
  float row = floor(gy);
  float col = floor(gx);

  // Lattice offsets — mirrors latticeCell() in pattern.ts.
  // u_lattice: 0 = square, 1 = brick, 2 = diagonal  (LATTICES order)
  if (u_lattice > 0.5 && u_lattice < 1.5 && posmod(row,2.0)==1.0) gx += 0.5;        // brick
  if (u_lattice > 1.5) {
    if (posmod(row,2.0)==1.0) gx += 0.5;
    if (posmod(col,2.0)==1.0) gy += 0.5;
  }                                                                                    // diagonal

  float cx = posmod(floor(gx), cells);
  float cy = posmod(floor(gy), cells);
  float fx = gx - floor(gx);
  float fy = gy - floor(gy);

  // Per-cell jitter: swap ink A/B for cells where hash < jitter threshold.
  // Hashes the modded cx/cy so the tile repeats seamlessly.
  float swap = (u_jitter > 0.0 && hash1(cx*73856093.0 + cy*19349663.0 + u_seed*83492791.0) < u_jitter) ? 1.0 : 0.0;
  vec3 ink  = mix(u_a, u_b, swap);
  vec3 ink2 = mix(u_b, u_a, swap);

  vec3 c;
  // u_motif: 0 = checker, 1 = stripes, 2 = dots, 3 = grid  (MOTIFS order)
  if (u_motif < 0.5) {                 // checker
    c = (posmod(cx+cy,2.0)==0.0) ? ink : ink2;
  } else if (u_motif < 1.5) {          // stripes — split point = u_scale, mirrors pattern.ts
    c = (fx < u_scale) ? ink : ink2;
  } else if (u_motif < 2.5) {          // dots
    c = (distance(vec2(fx,fy), vec2(0.5)) < u_scale*0.5) ? ink : u_bg;
  } else {                             // grid
    c = (fx < u_lw || fy < u_lw) ? ink : u_bg;
  }
  frag = vec4(c, 1.0);
}`

function hex(h: string): [number, number, number] {
  const s = h.replace('#', '')
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

class TextureFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null

  private ensure(w: number, h: number): WebGL2RenderingContext {
    if (!this.gl) {
      this.canvas = document.createElement('canvas')
      const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false })
      if (!gl) throw new Error('WebGL2 unavailable')
      this.gl = gl
      this.prog = this.compile(gl)
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(this.prog, 'a_pos')
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    }
    const c = this.canvas!
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    this.gl.viewport(0, 0, w, h)
    return this.gl
  }

  private compile(gl: WebGL2RenderingContext): WebGLProgram {
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s); gl.deleteShader(s)
        throw new Error(`texturefx compile: ${log}`)
      }
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`texturefx link: ${gl.getProgramInfoLog(p)}`)
    return p
  }

  render(p: Params, width: number, height: number, _time = 0): HTMLCanvasElement {
    const gl = this.ensure(width, height)
    gl.useProgram(this.prog!)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const u = (n: string) => gl.getUniformLocation(this.prog!, n)
    const li = Math.max(0, LATTICES.indexOf(String(p.lattice) as typeof LATTICES[number]))
    const mi = Math.max(0, MOTIFS.indexOf(String(p.motif) as typeof MOTIFS[number]))
    gl.uniform1f(u('u_cells'), Number(p.cells) || 8)
    gl.uniform1f(u('u_lattice'), li)
    gl.uniform1f(u('u_motif'), mi)
    gl.uniform1f(u('u_scale'), Number(p.scale) || 0.7)
    gl.uniform1f(u('u_lw'), Number(p.lineWeight) || 0.12)
    gl.uniform1f(u('u_jitter'), Number(p.jitter) || 0)
    gl.uniform1f(u('u_seed'), Math.round(Number(p.seed) || 1))
    gl.uniform3fv(u('u_a'), hex(String(p.colorA)))
    gl.uniform3fv(u('u_b'), hex(String(p.colorB)))
    gl.uniform3fv(u('u_bg'), hex(String(p.background)))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    return this.canvas!
  }

  async renderToBlob(p: Params, width: number, height: number, time = 0, type = 'image/png'): Promise<Blob> {
    const c = this.render(p, width, height, time)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type))
  }
}

// One WebGL renderer per page. Cached on `globalThis` rather than a plain module
// const so that Vite HMR re-evaluating this module during dev cannot spin up a
// second GL context — mirrors the same pattern as gradientfx/renderer.ts.
interface Scope { __comfynextTextureFx?: TextureFxRenderer }

export function resolveTextureFx(scope: Scope): TextureFxRenderer {
  return scope.__comfynextTextureFx ?? (scope.__comfynextTextureFx = new TextureFxRenderer())
}

export const textureFx = resolveTextureFx(globalThis as unknown as Scope)
