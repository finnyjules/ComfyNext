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
uniform float u_layerCount;    // 1 or 2

// Per-layer params (index 0,1).
uniform float u_count[2];
uniform float u_dir[2];        // 0 up,1 right,2 down,3 left
uniform float u_mirror[2];
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

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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

float sampleField(int i, float x) {
  return i == 0 ? texture(u_field0, vec2(clamp(x, 0.0, 1.0), 0.5)).r
                : texture(u_field1, vec2(clamp(x, 0.0, 1.0), 0.5)).r;
}
vec3 sampleRamp(int i, float t) {
  return i == 0 ? texture(u_ramp0, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb
                : texture(u_ramp1, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
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
  bool mirror = u_mirror[i] > 0.5;

  if (u_layout < 0.5) {
    // ---- Linear: full-height columns. The field offsets the vertical gradient
    // per column, giving the signature staggered-skyline look (not bars on black).
    float m = u_margin;
    vec2 q = (p - m) / max(1.0 - 2.0 * m, 0.001);
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return vec4(0.0);
    int dir = int(u_dir[i] + 0.5);
    float ba, da;
    if (dir == 0)      { ba = q.x; da = q.y; }        // up
    else if (dir == 2) { ba = q.x; da = 1.0 - q.y; }  // down
    else if (dir == 1) { ba = q.y; da = q.x; }        // right
    else               { ba = q.y; da = 1.0 - q.x; }  // left

    // Mirror folds the column axis about the centre (symmetric composition).
    float bax = mirror ? 1.0 - abs(2.0 * ba - 1.0) : ba;
    float bi = floor(bax * count);
    float bl = fract(bax * count);

    // Soft gap between columns lets the background show through.
    float colMask = 1.0;
    if (gap > 0.001) {
      float hg = gap * 0.5;
      colMask = smoothstep(hg, hg + 0.05, bl) * smoothstep(hg, hg + 0.05, 1.0 - bl);
      if (colMask <= 0.001) return vec4(0.0);
    }

    // Blend the field toward the neighbouring column near the seam so the
    // vertical bands transition softly instead of hard vertical edges.
    float fc = sampleField(i, (bi + 0.5) / count);
    float side = bl < 0.5 ? -1.0 : 1.0;
    float fn = sampleField(i, (bi + 0.5 + side) / count);
    // Bands keep crisp seams; other shapes blend toward the neighbour for soft columns.
    float blendAmt = mix(0.45, 0.06, u_crisp[i]);
    float f = mix(fc, fn, smoothstep(0.55, 1.0, abs(bl - 0.5) * 2.0) * blendAmt);

    float t;
    if (mapping < 0.5)      t = ba;                        // across (horizontal ramp)
    else if (mapping < 1.5) t = f;                         // per bar (flat colour per column)
    else                    t = da - (f - 0.5) * 1.15;     // field (offset vertical gradient)
    t += u_hueDrift[i] / 360.0 * (ba - 0.5);
    t = quantize(t, u_steps[i]);

    vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
    return vec4(col, colMask);
  }

  // ---- Radial / Orbit: clipped wedges / rings over the background. ----
  vec2 d = p - 0.5;
  d.x *= u_aspect;
  float r = length(d) * 2.0;
  float ang = fract(atan(d.y, d.x) / TAU + 0.5 + u_scrub[i]);
  float sweep = clamp(u_sweep[i], 0.02, 1.0);
  if (ang > sweep) return vec4(0.0);
  float ba = ang / sweep;
  if (mirror) ba = 1.0 - abs(2.0 * ba - 1.0);
  float inner = u_innerRadius;
  float outer = 1.0 - u_margin;
  float da = (r - inner) / max(outer - inner, 0.001);
  if (da < 0.0 || da > 1.0) return vec4(0.0);

  float bi = floor(ba * count);
  float bl = fract(ba * count);
  float halfGap = gap * 0.5;
  if (bl < halfGap || bl > 1.0 - halfGap) return vec4(0.0);

  float depth = sampleField(i, (bi + 0.5) / count);
  float edge = abs(bl - 0.5) * 2.0;
  depth *= 1.0 - u_rounding[i] * 0.5 * smoothstep(0.4, 1.0, edge);

  float feather = 0.02 + 0.05 * u_rounding[i];
  float fill = u_layout > 1.5
    ? exp(-pow((da - depth) / max(feather + 0.06, 0.02), 2.0))  // orbit band
    : smoothstep(depth + feather, depth - feather, da);         // radial wedge
  if (fill <= 0.001) return vec4(0.0);

  float t;
  if (mapping < 0.5)      t = ba;
  else if (mapping < 1.5) t = clamp(da / max(depth, 0.001), 0.0, 1.0);
  else                    t = depth;
  t += u_hueDrift[i] / 360.0 * (ba - 0.5);
  t = quantize(t, u_steps[i]);

  vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
  return vec4(col, fill);
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

  if (u_layerCount > 1.5) {
    vec4 l1 = computeLayer(1, p);
    vec3 blended = blendLayers(col, l1.rgb, u_blend[1]);
    col = mix(col, blended, l1.a * u_opacity[1]);
  }

  // Relief: gentle vertical shading from the luminance gradient feel.
  if (u_relief > 0.001) {
    float sh = 0.5 + 0.5 * sin((p.y + p.x * 0.2) * PI);
    col *= mix(1.0, 0.82 + 0.36 * sh, u_relief);
  }

  // Film grain.
  if (u_grain > 0.001) {
    float g = hash21(gl_FragCoord.xy + u_seed) - 0.5;
    col += g * u_grain * 0.35;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`
