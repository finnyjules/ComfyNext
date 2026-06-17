// frontend/app/lib/shaderstudio/glsl.ts
// Studio-level pipeline passes, expressed as ShaderFx-compatible fragment shaders.
// Contract (matches app/lib/shaderfx/renderer.ts): sampler u_image0 = previous pass,
// vec2 u_resolution, in vec2 v_texCoord, out vec4 fragColor0. All scalar uniforms set
// via uniform1f, so vec3 colors arrive as _r/_g/_b floats.

const HEAD = '#version 300 es\nprecision highp float;\nuniform sampler2D u_image0;\nuniform vec2 u_resolution;\nin vec2 v_texCoord;\nlayout(location = 0) out vec4 fragColor0;\n'

export const DUOTONE_FS = HEAD + `
uniform float u_ink_r, u_ink_g, u_ink_b;
uniform float u_paper_r, u_paper_g, u_paper_b;
void main() {
  vec4 src = texture(u_image0, v_texCoord);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec3 ink = vec3(u_ink_r, u_ink_g, u_ink_b);
  vec3 paper = vec3(u_paper_r, u_paper_g, u_paper_b);
  fragColor0 = vec4(mix(ink, paper, lum), src.a);
}
`

export const ADJUST_FS = HEAD + `
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_hue, u_temperature, u_tint;
vec3 hueRotate(vec3 c, float deg) {
  float a = radians(deg);
  float s = sin(a), co = cos(a);
  mat3 m = mat3(
    0.299 + 0.701*co + 0.168*s, 0.587 - 0.587*co + 0.330*s, 0.114 - 0.114*co - 0.497*s,
    0.299 - 0.299*co - 0.328*s, 0.587 + 0.413*co + 0.035*s, 0.114 - 0.114*co + 0.292*s,
    0.299 - 0.300*co + 1.250*s, 0.587 - 0.588*co - 1.050*s, 0.114 + 0.886*co - 0.203*s
  );
  return clamp(m * c, 0.0, 1.0);
}
void main() {
  vec4 src = texture(u_image0, v_texCoord);
  vec3 c = src.rgb;
  c *= pow(2.0, u_exposure);                       // exposure (stops)
  c += u_brightness;                               // brightness
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;        // contrast around mid-grey
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 1.0 + u_saturation);       // saturation
  if (u_hue != 0.0) c = hueRotate(c, u_hue);       // hue
  c.r += u_temperature * 0.1; c.b -= u_temperature * 0.1;  // temperature
  c.g += u_tint * 0.1;                              // tint
  fragColor0 = vec4(clamp(c, 0.0, 1.0), src.a);
}
`

export const LENS_BLUR_FS = HEAD + `
uniform float u_focusX, u_focusY, u_range, u_aperture, u_maxBlur;
void main() {
  vec2 focus = vec2(u_focusX, u_focusY);
  float d = distance(v_texCoord, focus);
  float blurPx = u_maxBlur * smoothstep(u_range, u_range + max(u_aperture, 0.001), d);
  if (blurPx < 0.5) { fragColor0 = texture(u_image0, v_texCoord); return; }
  vec2 px = blurPx / u_resolution;
  // 16-tap sunflower disc
  vec4 sum = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ang = float(i) * 2.39996323;            // golden angle
    vec2 off = vec2(cos(ang), sin(ang)) * sqrt(t) * px;
    sum += texture(u_image0, v_texCoord + off);
  }
  fragColor0 = sum / float(N);
}
`

export const CHROMATIC_FS = HEAD + `
uniform float u_amount;
void main() {
  vec2 dir = v_texCoord - 0.5;
  vec2 off = dir * u_amount * 0.03;
  float r = texture(u_image0, v_texCoord + off).r;
  vec4 g = texture(u_image0, v_texCoord);
  float b = texture(u_image0, v_texCoord - off).b;
  fragColor0 = vec4(r, g.g, b, g.a);
}
`
