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
  vec3 src = texture(u_src, clamp(uv, 0.0, 1.0)).rgb;

  // Python: result = base*(1-a) + blend(base, src)*a   (a = 0 outside the layer)
  float a = u_alpha * inside;
  outColor = vec4(mix(base, blendMode(base, src, u_mode), a), 1.0);
}
`
