// Singleton WebGL2 renderer for Texture Studio. One GL context app-wide; callers
// drawImage() the returned canvas (preview) or toBlob() it (export). A single
// fragment shader synthesizes the whole tile from lattice + motif uniforms,
// mirroring the pure-TS patternColor / latticeCell math in pattern.ts exactly.
// For structured placement it also imports truchetStates() from pattern.ts so
// the GPU samples the exact same state grid the CPU computes (shared source, not a mirror).

import type { Params } from '~/lib/spacetype/effect'
import { LATTICES, MOTIFS, MODES, TILE_FAMILIES } from '~/lib/texturefx/types'
import { truchetStates, multiscaleLevels } from '~/lib/texturefx/pattern'
import { getRaster } from '~/lib/texturefx/raster'

const VS = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 frag;
uniform float u_cells, u_lattice, u_motif, u_scale, u_lw, u_jitter, u_seed;
uniform float u_mode, u_family, u_rotBias, u_tw;
uniform float u_placement;
// u_stateTex (R8, cells×cells): multiscale → per-cell level (0=whole, 1=subdivide); structured placement → per-cell arc state (0/1).
uniform sampler2D u_stateTex;
uniform sampler2D u_rasterTex;
uniform float u_hasRaster, u_seamMethod, u_feather, u_rasterScale;
uniform vec3 u_a, u_b, u_bg;

float posmod(float a, float n){ return mod(mod(a,n)+n, n); }
float r_tri(float x){ return abs(2.0*fract(x)-1.0); }

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

// Shared arc-coverage helper: true when pixel f lies on one of the two quarter-
// circle arcs for state st. Mirrors arcCoverage() in pattern.ts exactly.
// state 0 -> centres (0,0)&(1,1); state 1 -> (1,0)&(0,1).
bool arcCov(vec2 f, float st, float tw) {
  vec2 a = (st < 0.5) ? vec2(0.0,0.0) : vec2(1.0,0.0);
  vec2 b = (st < 0.5) ? vec2(1.0,1.0) : vec2(0.0,1.0);
  return abs(distance(f,a)-0.5) < tw*0.5 || abs(distance(f,b)-0.5) < tw*0.5;
}

void main(){
  // raster branch — must be FIRST so it returns before any truchet/procedural logic
  if (u_mode > 1.5) { // raster (MODES index 2)
    if (u_hasRaster < 0.5) { frag = vec4(u_bg, 1.0); return; }
    float cu = (v_uv.x - 0.5)/u_rasterScale + 0.5;
    float cv = (v_uv.y - 0.5)/u_rasterScale + 0.5;
    vec3 col;
    if (u_seamMethod > 1.5) {        // direct: image already seamless → plain wrap
      col = texture(u_rasterTex, vec2(fract(cu), fract(cv))).rgb;
    } else if (u_seamMethod > 0.5) { // feather: offset-wrap + cross-fade heal at the centre seam
      // primary sample: fract(fract(cu)+0.5) mirrors raster.ts fract(zu+0.5) where zu=fract(cu)
      vec2 a = vec2(fract(fract(cu) + 0.5), fract(fract(cv) + 0.5));
      col = texture(u_rasterTex, a).rgb;
      // mirror sample: used only in the heal blend
      vec3 mir = texture(u_rasterTex, vec2(r_tri(cu), r_tri(cv))).rgb;
      float zu = fract(cu), zv = fract(cv);
      float fx = smoothstep(0.5 - u_feather, 0.5, zu) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zu));
      float fy = smoothstep(0.5 - u_feather, 0.5, zv) * (1.0 - smoothstep(0.5, 0.5 + u_feather, zv));
      col = mix(col, mir, max(fx, fy));
    } else {                         // mirror: triangle wave → seamless by construction; mirrors raster.ts tri(cu)
      col = texture(u_rasterTex, vec2(r_tri(cu), r_tri(cv))).rgb;
    }
    frag = vec4(col, 1.0);
    return;
  }

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

  // Truchet families — mirrors truchetColor() + the 'truchet' branch in patternColor().
  // u_mode: 0 = procedural, 1 = truchet  (MODES order)
  // u_family: 0 = arcs, 1 = diagonal, 2 = weave, 3 = multiscale  (TILE_FAMILIES order)
  if (u_mode > 0.5) {
    if (u_family > 2.5) { // multiscale: read level from u_stateTex, descend 3× when level=1
      float lvl = texelFetch(u_stateTex, ivec2(int(cx), int(cy)), 0).r > 0.5 ? 1.0 : 0.0;
      vec2 lf = vec2(fx, fy); float sub = 0.0;
      if (lvl > 0.5) {
        float sx = min(2.0, floor(fx*3.0)), sy = min(2.0, floor(fy*3.0));
        lf = vec2(fx*3.0 - sx, fy*3.0 - sy); sub = sx*3.0 + sy + 1.0; // sub: 0 = whole cell, 1-9 = row-major 3×3 sub-cell index (+1) — mirrors pattern.ts
      }
      float st2 = hash1(cx*73856093.0 + cy*19349663.0 + sub*50331653.0 + u_seed*83492791.0) < 0.5 ? 0.0 : 1.0;
      frag = vec4(arcCov(lf, st2, u_tw) ? u_a : u_bg, 1.0);
      return;
    }
    float h = hash1(cx*73856093.0 + cy*19349663.0 + u_seed*83492791.0);
    float st;
    if (u_placement > 0.5) {
      st = texelFetch(u_stateTex, ivec2(int(cx), int(cy)), 0).r > 0.5 ? 1.0 : 0.0;
    } else {
      st = (h < u_rotBias) ? 0.0 : 1.0;
    }
    vec3 col;
    if (u_family < 0.5) {            // arcs: state 0 → centers (0,0)&(1,1); state 1 → (1,0)&(0,1)
      col = arcCov(vec2(fx,fy), st, u_tw) ? u_a : u_bg;
    } else if (u_family < 1.5) {     // diagonal two-tone
      bool side = (st < 0.5) ? (fy < fx) : (fy < 1.0 - fx);
      col = side ? u_a : u_b;
    } else {                          // weave: warp(A) over weft(B), parity decides crossing
      float bw = 0.62;
      bool inV = abs(fx - 0.5) < bw*0.5;
      bool inH = abs(fy - 0.5) < bw*0.5;
      bool warpTop = posmod(cx+cy, 2.0) == 0.0;
      if (inV && inH) col = warpTop ? u_a : u_b;
      else if (inV) col = u_a;
      else if (inH) col = u_b;
      else col = u_bg;
    }
    frag = vec4(col, 1.0);
    return;
  }

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
  } else if (u_motif < 2.5) {          // dots — anti-aliased circle (smooth edge)
    float d = distance(vec2(fx, fy), vec2(0.5));
    float aa = max(fwidth(d), 1e-4);              // ~1px screen-space edge, res-independent
    float cov = 1.0 - smoothstep(u_scale*0.5 - aa, u_scale*0.5 + aa, d);
    c = mix(u_bg, ink, cov);
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
  private stateTex?: WebGLTexture
  private rasterTex?: WebGLTexture
  private _lastRasterSrc: string | null = null

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
      // No VAO needed: this renderer owns its own GL context and never shares it, so the default VAO's attribute state is stable across frames.
      this.stateTex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.stateTex)
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1) // R8 rows aren't 4-aligned; set once (isolated context)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // raster texture on UNIT 1 — LINEAR filter for smooth image sampling
      this.rasterTex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.rasterTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
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

  // _time is reserved for future animated/looping variants (time uniform wired later).
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
    gl.uniform1f(u('u_mode'), Math.max(0, MODES.indexOf(String(p.mode) as typeof MODES[number])))
    gl.uniform1f(u('u_family'), Math.max(0, TILE_FAMILIES.indexOf(String(p.tileFamily) as typeof TILE_FAMILIES[number])))
    gl.uniform1f(u('u_rotBias'), Number.isFinite(Number(p.rotBias)) ? Number(p.rotBias) : 0.5)
    gl.uniform1f(u('u_tw'), Number(p.truchetWeight) || 0.18)
    gl.uniform3fv(u('u_a'), hex(String(p.colorA)))
    gl.uniform3fv(u('u_b'), hex(String(p.colorB)))
    gl.uniform3fv(u('u_bg'), hex(String(p.background)))
    const family = String(p.tileFamily)
    const multiscale = String(p.mode) === 'truchet' && family === 'multiscale'
    const structured = String(p.mode) === 'truchet' && family !== 'multiscale' && String(p.placement) === 'structured'
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.stateTex!)
    if (multiscale || structured) {
      // integer cells/seed for the CPU grid generator; the u_cells/u_seed float uniforms above are unrounded by design
      const cellsI = Math.max(2, Math.round(Number(p.cells) || 8))
      const seedI = Math.round(Number(p.seed) || 1)
      const grid = multiscale
        ? multiscaleLevels(cellsI, seedI, Math.min(1, Math.max(0, Number(p.subdivide) || 0)))
        : truchetStates(cellsI, seedI, Math.min(1, Math.max(0, Number(p.coherence) || 0)))
      const data = new Uint8Array(grid.length)
      // R8 is normalized (samples b/255, shader tests >0.5): store 1 as 255, not 1.
      for (let i = 0; i < grid.length; i++) data[i] = grid[i] ? 255 : 0
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cellsI, cellsI, 0, gl.RED, gl.UNSIGNED_BYTE, data)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([0]))
    }
    gl.uniform1i(u('u_stateTex'), 0)
    gl.uniform1f(u('u_placement'), structured ? 1 : 0)
    // Raster texture on UNIT 1 — only re-upload when rasterSrc changes (avoids full texImage2D every slider drag)
    const raster = String(p.mode) === 'raster'
    const rimg = raster ? getRaster(String(p.rasterSrc ?? '')) : null
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.rasterTex!)
    if (rimg) {
      if (String(p.rasterSrc) !== this._lastRasterSrc) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, rimg)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        this._lastRasterSrc = String(p.rasterSrc)
      }
    } else if (this._lastRasterSrc !== null) {
      // fell out of raster mode (or image cleared) — reset to the 1×1 placeholder once
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
      this._lastRasterSrc = null
    }
    gl.uniform1i(u('u_rasterTex'), 1)
    gl.uniform1f(u('u_hasRaster'), rimg ? 1 : 0)
    gl.uniform1f(u('u_seamMethod'), Math.max(0, ['mirror', 'feather', 'direct'].indexOf(String(p.seamMethod))))
    gl.uniform1f(u('u_feather'), Number(p.feather) || 0.15)
    gl.uniform1f(u('u_rasterScale'), Number(p.rasterScale) || 1)
    // Restore active texture to UNIT 0 so subsequent state-tex reads remain correct
    gl.activeTexture(gl.TEXTURE0)
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
