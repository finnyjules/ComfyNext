// The Gradient Studio fragment shader. One pass synthesizes the whole image:
// for each of up to 2 layers it maps the pixel through the layout, samples the
// bar-depth field + gradient ramp, then blends the layers over the background
// and adds relief + grain. GLSL ES 3.00 (WebGL2).

export const GRADIENT_VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

export const GRADIENT_FS = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_aspect;        // canvas w/h
uniform float u_time;
uniform float u_seed;

uniform float u_layout;        // 0 linear, 1 radial, 2 orbit
uniform float u_margin;
uniform float u_innerRadius;
uniform vec3  u_bg;
uniform float u_grain;
uniform float u_relief;
uniform vec3  u_light;         // normalized light dir (x,y in screen plane, z toward viewer)
uniform vec2  u_center;        // radial/orbit origin offset
uniform float u_layerCount;    // 1 or 2

// Per-layer params (index 0,1).
uniform float u_count[2];
uniform float u_dir[2];        // 0 up,1 right,2 down,3 left
uniform float u_mirrorH[2];    // fold the image in X
uniform float u_mirrorV[2];    // fold the image in Y
uniform float u_gradHoriz[2];  // 1 = gradient ramp runs horizontally, 0 = vertically
uniform float u_gap[2];
uniform float u_rounding[2];
uniform float u_mapping[2];    // 0 across,1 perbar,2 field
uniform float u_steps[2];
uniform float u_hueDrift[2];
uniform float u_hueRotate[2];
uniform float u_sweep[2];      // radial sweep, fraction 0..1
uniform float u_scrub[2];
uniform float u_blend[2];      // 0 normal,1 lighten,2 screen,3 add,4 multiply,5 darken,6 overlay
uniform float u_opacity[2];
uniform float u_crisp[2];      // 1 = crisp bands (sharp seams), 0 = soft-blended columns

uniform sampler2D u_field0;
uniform sampler2D u_field1;
uniform sampler2D u_ramp0;
uniform sampler2D u_ramp1;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

// Higher-quality hash (Dave Hoskins, "Hash without Sine") for film grain — the older
// fract-multiply hash showed a visible repeating tile at coarse cell sizes; this stays
// patternless even per device pixel.
float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0, s = 0.0;
  if (d > 0.00001) {
    s = d / (1.0 - abs(2.0 * l - 1.0));
    if (mx == c.r)      h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else                h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x * 6.0, s = hsl.y, l = hsl.z;
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
  vec3 rgb;
  if (h < 1.0)      rgb = vec3(c, x, 0);
  else if (h < 2.0) rgb = vec3(x, c, 0);
  else if (h < 3.0) rgb = vec3(0, c, x);
  else if (h < 4.0) rgb = vec3(0, x, c);
  else if (h < 5.0) rgb = vec3(x, 0, c);
  else              rgb = vec3(c, 0, x);
  return rgb + (l - 0.5 * c);
}
vec3 rotateHue(vec3 col, float deg) {
  if (abs(deg) < 0.001) return col;
  vec3 hsl = rgb2hsl(col);
  hsl.x = fract(hsl.x + deg / 360.0);
  return hsl2rgb(hsl);
}

// textureLod (explicit LOD 0) — the field/ramp textures are mip-less so the result
// is identical to texture(), but it stays well-defined when sampled from the relief
// height function, which runs in non-uniform control flow.
float sampleField(int i, float x) {
  return i == 0 ? textureLod(u_field0, vec2(clamp(x, 0.0, 1.0), 0.5), 0.0).r
                : textureLod(u_field1, vec2(clamp(x, 0.0, 1.0), 0.5), 0.0).r;
}
vec3 sampleRamp(int i, float t) {
  return i == 0 ? textureLod(u_ramp0, vec2(clamp(t, 0.0, 1.0), 0.5), 0.0).rgb
                : textureLod(u_ramp1, vec2(clamp(t, 0.0, 1.0), 0.5), 0.0).rgb;
}

float quantize(float t, float steps) {
  if (steps < 1.0) return t;
  return floor(clamp(t, 0.0, 1.0) * steps) / max(steps - 1.0, 1.0);
}

// Returns layer color in .rgb and coverage alpha in .a.
vec4 computeLayer(int i, vec2 p) {
  float count = max(1.0, u_count[i]);
  float gap = u_gap[i];
  float mapping = u_mapping[i];
  bool mirrorH = u_mirrorH[i] > 0.5;
  bool mirrorV = u_mirrorV[i] > 0.5;
  bool gradHoriz = u_gradHoriz[i] > 0.5;

  if (u_layout < 0.5) {
    // ---- Linear: full-height columns. The field offsets the gradient per band,
    // giving the signature staggered-skyline look (not bars on black). The band
    // axis is always perpendicular to the gradient, so both orientations read as bands.
    float m = u_margin;
    vec2 q = (p - m) / max(1.0 - 2.0 * m, 0.001);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    // Mirror folds the image in screen space (H = X, V = Y).
    if (mirrorH) q.x = 1.0 - abs(2.0 * q.x - 1.0);
    if (mirrorV) q.y = 1.0 - abs(2.0 * q.y - 1.0);

    // Band axis comes from Direction (↑↓ = vertical bands, →← = horizontal bands);
    // gradient axis comes independently from Gradient direction, so the ramp can
    // run ACROSS the bands (e.g. horizontal gradient over vertical bands).
    int dir = int(u_dir[i] + 0.5);
    bool vertBands = (dir == 0 || dir == 2);
    float band = vertBands ? q.x : q.y;
    float grad = gradHoriz ? q.x : q.y;
    if (dir == 2 || dir == 3) grad = 1.0 - grad;  // down/left reverse the gradient

    float bi = floor(band * count);
    float bl = fract(band * count);

    // Soft gap between bands lets the background show through.
    float colMask = 1.0;
    if (gap > 0.001) {
      float hg = gap * 0.5;
      float fw = 0.04 + 0.18 * u_rounding[i];  // Rounding softens the gap edges
      colMask = smoothstep(hg, hg + fw, bl) * smoothstep(hg, hg + fw, 1.0 - bl);
      if (colMask <= 0.001) return vec4(0.0);
    }

    // Blend the field toward the neighbouring band near the seam so non-Bands
    // shapes transition softly; Bands keep crisp seams.
    float fc = sampleField(i, (bi + 0.5) / count);
    float side = bl < 0.5 ? -1.0 : 1.0;
    float fn = sampleField(i, (bi + 0.5 + side) / count);
    float blendAmt = mix(0.45, 0.06, u_crisp[i]);
    float f = mix(fc, fn, smoothstep(0.55, 1.0, abs(bl - 0.5) * 2.0) * blendAmt);

    float t;
    if (mapping < 0.5)      t = band;                     // across (along the band axis)
    else if (mapping < 1.5) t = f;                        // per bar (flat color per band)
    else                    t = grad - (f - 0.5) * 1.15;  // field (offset gradient)
    t += u_hueDrift[i] / 360.0 * (band - 0.5);
    t = quantize(t, u_steps[i]);

    vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
    return vec4(col, colMask);
  }

  // ---- Radial / Orbit: the linear band model wrapped into polar coords. The
  // field offsets the gradient per band → a circular wave. Radial = angular bands
  // with a radial gradient; Orbit = concentric ring bands with an angular gradient.
  bool orbit = u_layout > 1.5;
  vec2 d = p - 0.5 - u_center;
  d.x *= u_aspect;
  float r = length(d) * 2.0;                       // 0 centre .. ~1 edge
  float angN = fract(atan(d.y, d.x) / TAU + 0.5 + u_scrub[i]);
  float sweep = clamp(u_sweep[i], 0.02, 1.0);
  if (angN > sweep) return vec4(0.0);
  angN /= sweep;                                   // 0..1 within the swept arc
  float inner = u_innerRadius;
  float outer = 1.0 - u_margin;
  float rN = (r - inner) / max(outer - inner, 0.001);
  if (rN < 0.0 || rN > 1.0) return vec4(0.0);      // outside the annulus → background

  if (mirrorH) angN = 1.0 - abs(2.0 * angN - 1.0); // fold angle
  if (mirrorV) rN = 1.0 - abs(2.0 * rN - 1.0);     // fold radius

  // Band axis vs gradient axis (perpendicular by default; gradient-direction flips).
  float band = orbit ? rN : angN;
  float gradPerp = orbit ? angN : rN;
  float gradAlong = orbit ? rN : angN;
  float grad = gradHoriz ? gradAlong : gradPerp;

  float bi = floor(band * count);
  float bl = fract(band * count);

  // Soft gap between bands; Rounding widens the gap feather (rounded band ends).
  float colMask = 1.0;
  if (gap > 0.001) {
    float hg = gap * 0.5;
    float fw = 0.04 + 0.18 * u_rounding[i];
    colMask = smoothstep(hg, hg + fw, bl) * smoothstep(hg, hg + fw, 1.0 - bl);
    if (colMask <= 0.001) return vec4(0.0);
  }

  float fc = sampleField(i, (bi + 0.5) / count);
  float side = bl < 0.5 ? -1.0 : 1.0;
  float fn = sampleField(i, (bi + 0.5 + side) / count);
  float blendAmt = mix(0.45, 0.06, u_crisp[i]);
  float f = mix(fc, fn, smoothstep(0.55, 1.0, abs(bl - 0.5) * 2.0) * blendAmt);

  float t;
  bool tWraps;                                          // does t derive from the angular coord?
  if (mapping < 0.5)      { t = band;                    tWraps = !orbit; }      // across: orbit band=radius, radial band=angle
  else if (mapping < 1.5) { t = f;                       tWraps = false; }       // per bar (flat color per band)
  else                    { t = grad - (f - 0.5) * 1.15; tWraps = orbit ? !gradHoriz : gradHoriz; } // field (offset gradient)
  t += u_hueDrift[i] / 360.0 * (band - 0.5);
  t = quantize(t, u_steps[i]);
  // Angular gradients wrap 360°: fract makes a ramp whose ends match seamless (no seam).
  if (tWraps) t = fract(t);

  vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
  return vec4(col, colMask);
}

// Height of the embossed band/ring surface at screen point q for layer i, used by
// the relief lighting. Mirrors computeLayer's band mapping but returns a scalar height:
// a rounded ridge per band (peaking mid-band) scaled by the band's field depth. Returns
// 0 outside the mask so the background reads as flat. No derivative ops here, so the
// early-returns are safe.
float bandHeight(int i, vec2 q) {
  float count = max(1.0, u_count[i]);
  bool mirrorH = u_mirrorH[i] > 0.5;
  bool mirrorV = u_mirrorV[i] > 0.5;
  float band;

  if (u_layout < 0.5) {
    float m = u_margin;
    vec2 uv = (q - m) / max(1.0 - 2.0 * m, 0.001);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    if (mirrorH) uv.x = 1.0 - abs(2.0 * uv.x - 1.0);
    if (mirrorV) uv.y = 1.0 - abs(2.0 * uv.y - 1.0);
    int dir = int(u_dir[i] + 0.5);
    bool vertBands = (dir == 0 || dir == 2);
    band = vertBands ? uv.x : uv.y;
  } else {
    bool orbit = u_layout > 1.5;
    vec2 d = q - 0.5 - u_center;
    d.x *= u_aspect;
    float r = length(d) * 2.0;
    float angN = fract(atan(d.y, d.x) / TAU + 0.5 + u_scrub[i]);
    float sweep = clamp(u_sweep[i], 0.02, 1.0);
    if (angN > sweep) return 0.0;
    angN /= sweep;
    float inner = u_innerRadius;
    float outer = 1.0 - u_margin;
    float rN = (r - inner) / max(outer - inner, 0.001);
    if (rN < 0.0 || rN > 1.0) return 0.0;
    if (mirrorH) angN = 1.0 - abs(2.0 * angN - 1.0);
    if (mirrorV) rN = 1.0 - abs(2.0 * rN - 1.0);
    band = orbit ? rN : angN;
  }

  // Honour the gap: zero height in the background slot between bands.
  float bl = fract(band * count);
  float gap = u_gap[i];
  if (gap > 0.001) {
    float hg = gap * 0.5;
    if (bl < hg || bl > 1.0 - hg) return 0.0;
  }
  float bi = floor(band * count);
  float f = sampleField(i, (bi + 0.5) / count);

  // Rounded ridge within the band: sin peaks mid-band; Rounding fattens the tube.
  float ridge = sin(clamp(bl, 0.0, 1.0) * PI);
  ridge = pow(ridge, mix(2.2, 0.6, u_rounding[i]));
  return f * ridge;
}

vec3 blendLayers(vec3 base, vec3 src, float mode) {
  int m = int(mode + 0.5);
  if (m == 1) return max(base, src);
  if (m == 2) return 1.0 - (1.0 - base) * (1.0 - src);
  if (m == 3) return min(base + src, vec3(1.0));
  if (m == 4) return base * src;
  if (m == 5) return min(base, src);
  if (m == 6) return mix(2.0 * base * src, 1.0 - 2.0 * (1.0 - base) * (1.0 - src), step(0.5, base));
  return src; // normal
}

void main() {
  vec2 p = v_texCoord;
  vec3 col = u_bg;

  vec4 l0 = computeLayer(0, p);
  col = mix(col, l0.rgb, l0.a);
  float cover = l0.a;                       // shape coverage (0 = background)

  if (u_layerCount > 1.5) {
    vec4 l1 = computeLayer(1, p);
    vec3 blended = blendLayers(col, l1.rgb, u_blend[1]);
    float a = l1.a * u_opacity[1];
    col = mix(col, blended, a);
    cover = max(cover, a);
  }

  // 3D relief: light the band/ring height-field of layer 0 (the primary structure).
  // Finite-difference normal from bandHeight, Lambert-shaded against u_light. Sidesteps
  // dFdx, which is undefined here because bandHeight early-returns at the mask edges.
  if (u_relief > 0.001) {
    float e = 1.5 / u_resolution.y;            // ~1.5px step in normalized units
    float h  = bandHeight(0, p);
    float hx = bandHeight(0, p + vec2(e, 0.0));
    float hy = bandHeight(0, p + vec2(0.0, e));
    const float bump = 0.045;                  // slope-to-normal scale (emboss height)
    vec3 n = normalize(vec3(-(hx - h) / e * bump, -(hy - h) / e * bump, 1.0));
    float diff = clamp(dot(n, normalize(u_light)), 0.0, 1.0);
    float shade = mix(0.48, 1.12, diff);       // ambient floor .. slight key overbright
    col *= mix(1.0, shade, u_relief);
  }

  // Film grain. Sampled PER DEVICE PIXEL (gl_FragCoord) — a coarser texCoord grid fell
  // below 1px at preview resolution and beat against the pixel grid into a visible
  // repeating tile. Per-pixel + a patternless hash keeps it clean at every resolution.
  // Gated to shape coverage (clean background) and luminance-shaped (filmic midtone bias).
  if (u_grain > 0.001 && cover > 0.001) {
    float g = hashGrain(gl_FragCoord.xy + u_seed) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float midtone = 0.35 + 0.65 * (lum * (1.0 - lum) * 4.0);   // 0.35 floor .. 1 at lum 0.5
    col += g * u_grain * 0.16 * cover * midtone;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`
