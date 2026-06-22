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
import { fillForRole, hexToRgb } from '~/lib/texturefx/fills'
import { rolesFor } from '~/lib/texturefx/roles'
import { getPatternFillCanvas, patternFillKey } from '~/lib/texturefx/patternfill'

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
uniform int u_fillType[3];
uniform int u_fillFrame[3];
uniform int u_fillKind[3];
uniform float u_fillAngle[3];
uniform vec3 u_fillC0[3];
uniform vec3 u_fillC1[3];
uniform sampler2D u_fillTex0, u_fillTex1, u_fillTex2;
uniform int u_fillSeam[3];   // 0 mirror, 1 feather, 2 direct
uniform float u_fillScale[3];

float posmod(float a, float n){ return mod(mod(a,n)+n, n); }
float r_tri(float x){ return abs(2.0*fract(x)-1.0); }

// Dispatch to a constant sampler per branch - dynamic array indexing is illegal in GLSL ES 3.00.
vec3 sampleFillTex(int r, vec2 uv){
  if (r == 0) return texture(u_fillTex0, uv).rgb;
  if (r == 1) return texture(u_fillTex1, uv).rgb;
  return texture(u_fillTex2, uv).rgb;
}

// Scale around center then apply seam mode before sampling.
vec3 sampleFillSeam(int r, vec2 uv){
  float s = max(u_fillScale[r], 0.0001);
  float cu = (uv.x - 0.5)/s + 0.5;
  float cv = (uv.y - 0.5)/s + 0.5;
  if (u_fillSeam[r] == 2) return sampleFillTex(r, vec2(fract(cu), fract(cv)));
  if (u_fillSeam[r] == 1) {
    vec2 a = fract(vec2(cu, cv) + 0.5);
    return sampleFillTex(r, a);
  }
  return sampleFillTex(r, vec2(r_tri(cu), r_tri(cv)));
}

// Evaluate role r fill at cell-local fc and tile coord tc. Solid + image + 2-stop gradient.
// Tile-global linear uses mirrored ramp for seamless tiling.
vec3 evalFill(int r, vec2 fc, vec2 tc){
  if (u_fillType[r] == 0) return u_fillC0[r];
  if (u_fillType[r] == 2) {
    vec2 uv = (u_fillFrame[r]==1) ? tc : fc;
    return sampleFillSeam(r, uv);
  }
  // Pattern fill (type 3): sub-pattern already tiles, so direct wrap (seam=2).
  // Scale and frame are honoured via sampleFillSeam like image fills.
  if (u_fillType[r] == 3) {
    vec2 uv = (u_fillFrame[r]==1) ? tc : fc;
    return sampleFillSeam(r, uv);
  }
  float g;
  if (u_fillKind[r] == 1) {
    vec2 p = (u_fillFrame[r]==1) ? tc : fc;
    g = clamp(length(p - vec2(0.5)) * 2.0, 0.0, 1.0);
  } else {
    float a = radians(u_fillAngle[r]);
    vec2 d = vec2(cos(a), sin(a));
    if (u_fillFrame[r]==1) {
      // Snap direction to integer wave numbers so the ramp completes whole
      // cycles per tile in each axis -- seamless at any angle (8 directions).
      float m = max(abs(d.x), abs(d.y));
      vec2 k = (m > 0.0) ? vec2(floor(d.x/m + 0.5), floor(d.y/m + 0.5)) : vec2(1.0, 0.0);
      float t = dot(tc, k);
      g = 1.0 - abs(2.0*fract(t) - 1.0);
    } else {
      g = clamp(dot(fc, d), 0.0, 1.0);
    }
  }
  return mix(u_fillC0[r], u_fillC1[r], g);
}

// Precision-safe per-cell hash to 0..1, well-distributed. Takes the SMALL modded
// cell coords (cx,cy up to cells) plus a salt (reduced seed, optionally + sub),
// so it never forms a huge float. The old cx*73856093 + ... overflowed float32
// 24-bit integer precision, collapsing the distribution and making rotBias
// erratic. (Dave Hoskins hash13.) Hashing the modded cx/cy keeps tiles seamless.
float cellHash(float cx, float cy, float salt){
  vec3 p = fract(vec3(cx, cy, salt) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
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
  float hseed = mod(u_seed, 977.0); // small, precision-safe seed salt for cellHash

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
      float st2 = cellHash(cx, cy, hseed + sub*1.7) < 0.5 ? 0.0 : 1.0;
      frag = vec4(arcCov(lf, st2, u_tw) ? evalFill(0, lf, v_uv) : evalFill(1, lf, v_uv), 1.0);
      return;
    }
    float h = cellHash(cx, cy, hseed);
    float st;
    if (u_placement > 0.5) {
      st = texelFetch(u_stateTex, ivec2(int(cx), int(cy)), 0).r > 0.5 ? 1.0 : 0.0;
    } else {
      st = (h < u_rotBias) ? 0.0 : 1.0;
    }
    vec3 col;
    if (u_family < 0.5) {            // arcs: stroke=role0, ground=role1
      col = arcCov(vec2(fx,fy), st, u_tw) ? evalFill(0, vec2(fx,fy), v_uv) : evalFill(1, vec2(fx,fy), v_uv);
    } else if (u_family < 1.5) {     // diagonal two-tone: sideA=role0, sideB=role1
      bool side = (st < 0.5) ? (fy < fx) : (fy < 1.0 - fx);
      col = side ? evalFill(0, vec2(fx,fy), v_uv) : evalFill(1, vec2(fx,fy), v_uv);
    } else {                          // weave: warp=role0, weft=role1, gap=role2
      float bw = 0.44 + u_tw;
      bool inV = abs(fx - 0.5) < bw*0.5;
      bool inH = abs(fy - 0.5) < bw*0.5;
      bool warpTop = (posmod(cx+cy, 2.0) == 0.0) != (st > 0.5);
      if (inV && inH) col = warpTop ? evalFill(0, vec2(fx,fy), v_uv) : evalFill(1, vec2(fx,fy), v_uv);
      else if (inV) col = evalFill(0, vec2(fx,fy), v_uv);
      else if (inH) col = evalFill(1, vec2(fx,fy), v_uv);
      else col = evalFill(2, vec2(fx,fy), v_uv);
    }
    frag = vec4(col, 1.0);
    return;
  }

  // Per-cell jitter: swap role0/role1 for cells where hash < jitter threshold.
  // Swap applies only to checker and stripes (two-tone motifs); dots/grid use roles directly.
  float swap = (u_jitter > 0.0 && cellHash(cx, cy, hseed + 3.0) < u_jitter) ? 1.0 : 0.0;
  vec3 F0 = evalFill(0, vec2(fx,fy), v_uv);
  vec3 F1 = evalFill(1, vec2(fx,fy), v_uv);
  // Jitter-swapped aliases for checker/stripes only
  vec3 ink  = (swap > 0.5) ? F1 : F0;
  vec3 ink2 = (swap > 0.5) ? F0 : F1;

  vec3 c;
  // u_motif: 0 = checker, 1 = stripes, 2 = dots, 3 = grid  (MOTIFS order)
  if (u_motif < 0.5) {                 // checker: role0/role1 with jitter swap
    c = (posmod(cx+cy,2.0)==0.0) ? ink : ink2;
  } else if (u_motif < 1.5) {          // stripes: role0/role1 with jitter swap
    c = (fx < u_scale) ? ink : ink2;
  } else if (u_motif < 2.5) {          // dots: role0=dot, role1=ground, no swap
    float d = distance(vec2(fx, fy), vec2(0.5));
    float aa = max(fwidth(d), 1e-4);
    float cov = 1.0 - smoothstep(u_scale*0.5 - aa, u_scale*0.5 + aa, d);
    c = mix(F1, F0, cov);
  } else {                             // grid: role0=line, role1=ground, no swap
    c = (fx < u_lw || fy < u_lw) ? F0 : F1;
  }
  frag = vec4(c, 1.0);
}`

class TextureFxRenderer {
  private canvas: HTMLCanvasElement | null = null
  private gl: WebGL2RenderingContext | null = null
  private prog: WebGLProgram | null = null
  private stateTex?: WebGLTexture
  private rasterTex?: WebGLTexture
  private fillTex: WebGLTexture[] = []
  private _lastRasterSrc: string | null = null
  private _lastFillSrc: (string | null)[] = [null, null, null]

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
      // fill textures on UNITS 2/3/4 - one per role, gray 1x1 placeholder
      // Pre-bind each to its intended unit at creation so samplers never read an
      // unbound unit (which returns (0,0,0,0)) even before the first image upload.
      this.fillTex = []
      for (let i = 0; i < 3; i++) {
        const ft = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE0 + 2 + i)
        gl.bindTexture(gl.TEXTURE_2D, ft)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]))
        this.fillTex.push(ft)
      }
      gl.activeTexture(gl.TEXTURE0)
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
    gl.uniform3fv(u('u_a'), hexToRgb(String(p.colorA)))
    gl.uniform3fv(u('u_b'), hexToRgb(String(p.colorB)))
    gl.uniform3fv(u('u_bg'), hexToRgb(String(p.background)))
    const roles = rolesFor(p)
    for (let r = 0; r < 3; r++) {
      const roleKey = roles[r]
      const fill = roleKey !== undefined ? fillForRole(p, roleKey, r) : { type: 'solid' as const, color: '#000000' }
      const loc = (n: string) => gl.getUniformLocation(this.prog!, `${n}[${r}]`)
      // Unconditionally reset image-only uniforms to sane defaults so a role that
      // previously held an image and is now solid/gradient does not keep stale values.
      // The image branch below overrides these when an image is actually present.
      gl.uniform1i(loc('u_fillSeam'), 0)
      gl.uniform1f(loc('u_fillScale'), 1)
      if (fill.type === 'image') {
        const fimg = getRaster(String(fill.src ?? ''))
        if (fimg) {
          gl.activeTexture(gl.TEXTURE0 + 2 + r)
          gl.bindTexture(gl.TEXTURE_2D, this.fillTex[r]!)
          if (String(fill.src) !== this._lastFillSrc[r]) {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, fimg)
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
            this._lastFillSrc[r] = String(fill.src)
          }
          const seam = fill.seam === 'direct' ? 2 : fill.seam === 'feather' ? 1 : 0
          gl.uniform1i(loc('u_fillType'), 2)
          gl.uniform1i(loc('u_fillFrame'), fill.frame === 'tile' ? 1 : 0)
          gl.uniform1i(loc('u_fillSeam'), seam)
          gl.uniform1f(loc('u_fillScale'), Number(fill.scale) || 1)
        } else {
          // image not yet decoded - show neutral gray placeholder
          this._lastFillSrc[r] = null
          gl.uniform1i(loc('u_fillType'), 0)
          gl.uniform3fv(loc('u_fillC0'), hexToRgb('#808080'))
        }
      } else if (fill.type === 'pattern') {
        const pc = getPatternFillCanvas(fill.sub as Record<string, unknown>)
        if (pc) {
          gl.activeTexture(gl.TEXTURE0 + 2 + r)
          gl.bindTexture(gl.TEXTURE_2D, this.fillTex[r]!)
          const pkey = patternFillKey(fill.sub as Record<string, unknown>)
          if (pkey !== this._lastFillSrc[r]) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pc)
            this._lastFillSrc[r] = pkey
          }
          gl.uniform1i(loc('u_fillType'), 3)
          // Sub-pattern already tiles cleanly; use direct wrap (seam=2) always.
          gl.uniform1i(loc('u_fillSeam'), 2)
          gl.uniform1f(loc('u_fillScale'), Number(fill.scale) || 1)
          gl.uniform1i(loc('u_fillFrame'), fill.frame === 'tile' ? 1 : 0)
        } else {
          // Sub-render failed or not ready — solid gray fallback
          this._lastFillSrc[r] = null
          gl.uniform1i(loc('u_fillType'), 0)
          gl.uniform3fv(loc('u_fillC0'), hexToRgb('#808080'))
        }
      } else if (fill.type === 'gradient') {
        this._lastFillSrc[r] = null
        gl.uniform1i(loc('u_fillType'), 1)
        gl.uniform1i(loc('u_fillFrame'), fill.frame === 'tile' ? 1 : 0)
        gl.uniform1i(loc('u_fillKind'), fill.kind === 'radial' ? 1 : 0)
        gl.uniform1f(loc('u_fillAngle'), Number(fill.angle) || 0)
        gl.uniform3fv(loc('u_fillC0'), hexToRgb(String(fill.stops?.[0]?.c ?? '#ffffff')))
        gl.uniform3fv(loc('u_fillC1'), hexToRgb(String(fill.stops?.[fill.stops.length - 1]?.c ?? '#000000')))
      } else {
        this._lastFillSrc[r] = null
        gl.uniform1i(loc('u_fillType'), 0)
        gl.uniform3fv(loc('u_fillC0'), hexToRgb(String((fill as any).color ?? '#000000')))
      }
    }
    // Bind fill sampler uniforms once after the loop (units 2/3/4)
    gl.uniform1i(u('u_fillTex0'), 2)
    gl.uniform1i(u('u_fillTex1'), 3)
    gl.uniform1i(u('u_fillTex2'), 4)
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

// Factory for creating an independent renderer instance (used by patternfill.ts
// to sub-render pattern fills on a separate GL context without re-entering the singleton).
export function createTextureFx(): TextureFxRenderer { return new TextureFxRenderer() }

export function resolveTextureFx(scope: Scope): TextureFxRenderer {
  return scope.__comfynextTextureFx ?? (scope.__comfynextTextureFx = new TextureFxRenderer())
}

export const textureFx = resolveTextureFx(globalThis as unknown as Scope)
