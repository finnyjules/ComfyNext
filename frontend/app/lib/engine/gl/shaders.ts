// GLSL for the timeline layer pass. The blend block is a 1:1 port of
// shared/timeline/blendModes.ts (itself a mirror of Python _blend_np — the
// golden formula set). tests/gl-blend-conformance.spec.ts holds this shader to
// the TS reference; change them together.

export const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_pos;   // fullscreen triangle, clip space
out vec2 v_uv;                         // 0..1, y-down image space
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

export const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_base;   // accumulated canvas so far (full canvas)
uniform sampler2D u_src;    // source image
uniform vec2  u_canvas;     // canvas size, px
uniform vec2  u_center;     // layer center, px
uniform vec2  u_size;       // layer size (pre-rotation), px
uniform float u_rotation;   // radians; sign verified against goldens (Task 7)
uniform float u_alpha;      // opacity * fade
uniform int   u_mode;       // BLEND_MODE_INDEX
uniform int   u_wipeMode;   // 0 none, 1 left (show x<w), 2 right (show x>1-w)
uniform float u_wipeW;      // transition weight 0..1
// ClipFilters — 1:1 port of shared/timeline/filters.ts applyFiltersRGB
// (order + clamps + constants pinned there; Python twin _apply_filters_np).
uniform float u_brightness; // additive, -1..1 (0 = identity)
uniform float u_contrast;   // multiplier around 0.5 (1 = identity)
uniform float u_saturation; // multiplier (1 = identity)
uniform float u_hue;        // radians (0 = identity)
uniform float u_temperature;// -1..1 (0 = identity)

in vec2 v_uv;
out vec4 outColor;

vec3 blendMode(vec3 a, vec3 b, int m) {
  if (m == 0) return b;                                       // normal
  if (m == 1) return a * b;                                   // multiply
  if (m == 2) return 1.0 - (1.0 - a) * (1.0 - b);             // screen
  if (m == 3) {                                               // overlay (switch on base)
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(hi, lo, vec3(lessThan(a, vec3(0.5))));
  }
  if (m == 4) return (1.0 - 2.0 * b) * a * a + 2.0 * b * a;   // soft_light (pegtop — matches _blend_np, NOT W3C)
  if (m == 5) {                                               // hard_light (switch on top)
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(hi, lo, vec3(lessThan(b, vec3(0.5))));
  }
  if (m == 6) return abs(a - b);                              // difference
  if (m == 7) return max(a, b);                               // lighten
  if (m == 8) return min(a, b);                               // darken
  if (m == 9) return clamp(a + b, 0.0, 1.0);                  // add
  return b;
}

vec3 applyFilters(vec3 c) {
  c = clamp(c + vec3(u_brightness), 0.0, 1.0);
  c = clamp((c - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = clamp(vec3(luma) + (c - vec3(luma)) * u_saturation, 0.0, 1.0);
  if (u_hue != 0.0) {
    float hc = cos(u_hue);
    float hs = sin(u_hue);
    // SVG feColorMatrix hueRotate (luma consts 0.213/0.715/0.072)
    mat3 m = mat3(
      0.213 + hc * 0.787 - hs * 0.213, 0.213 - hc * 0.213 + hs * 0.143, 0.213 - hc * 0.213 - hs * 0.787,
      0.715 - hc * 0.715 - hs * 0.715, 0.715 + hc * 0.285 + hs * 0.140, 0.715 - hc * 0.715 + hs * 0.715,
      0.072 - hc * 0.072 + hs * 0.928, 0.072 - hc * 0.072 - hs * 0.283, 0.072 + hc * 0.928 + hs * 0.072
    );
    c = clamp(m * c, 0.0, 1.0);
  }
  if (u_temperature != 0.0) {
    c.r = clamp(c.r * (1.0 + 0.2 * u_temperature), 0.0, 1.0);
    c.b = clamp(c.b * (1.0 - 0.2 * u_temperature), 0.0, 1.0);
  }
  return c;
}

void main() {
  vec3 base = texture(u_base, v_uv).rgb;

  // Inverse-map this canvas pixel into the layer's local UV.
  vec2 p = v_uv * u_canvas;
  vec2 d = p - u_center;
  float c = cos(u_rotation);
  float s = sin(u_rotation);
  vec2 local = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  vec2 uv = local / u_size + 0.5;

  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 srcTex = texture(u_src, clamp(uv, 0.0, 1.0));
  vec3 src = applyFilters(srcTex.rgb);

  // Wipe transitions reveal the incoming layer by canvas column. Python twin
  // masks alpha columns at floor(w*W + 0.5) — pixel centers, same boundary.
  float wipeMask = 1.0;
  if (u_wipeMode == 1) wipeMask = v_uv.x < u_wipeW ? 1.0 : 0.0;
  else if (u_wipeMode == 2) wipeMask = v_uv.x > (1.0 - u_wipeW) ? 1.0 : 0.0;

  // Python: result = base*(1-a) + blend(base, src)*a  (a = 0 outside the layer;
  // src alpha modulates coverage — opaque media uploads with alpha=1 so this is
  // a no-op for image/video layers and only bites for rasterized text).
  float a = u_alpha * inside * srcTex.a * wipeMask;
  outColor = vec4(mix(base, blendMode(base, src, u_mode), a), 1.0);
}
`
