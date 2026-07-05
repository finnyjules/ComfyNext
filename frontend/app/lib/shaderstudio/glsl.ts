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

// Multi-stop gradient map: remap luminance through up to 8 color stops.
// Stops arrive pos-sorted; positions/colours passed as array uniforms so the
// whole ramp is one pass with no LUT texture.
export const GRADIENT_MAP_FS = HEAD + `
#define MAXS 8
uniform float u_gm_n;
uniform float u_gm_pos[MAXS];
uniform float u_gm_r[MAXS];
uniform float u_gm_g[MAXS];
uniform float u_gm_b[MAXS];
uniform float u_gm_mix;
vec3 stopColor(int i) { return vec3(u_gm_r[i], u_gm_g[i], u_gm_b[i]); }
void main() {
  vec4 src = texture(u_image0, v_texCoord);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  int n = int(u_gm_n + 0.5);
  vec3 mapped = stopColor(0);
  if (n >= 2) {
    if (lum <= u_gm_pos[0]) {
      mapped = stopColor(0);
    } else if (lum >= u_gm_pos[n - 1]) {
      mapped = stopColor(n - 1);
    } else {
      for (int i = 0; i < MAXS - 1; i++) {
        if (i + 1 >= n) break;
        float p0 = u_gm_pos[i], p1 = u_gm_pos[i + 1];
        if (lum >= p0 && lum <= p1) {
          float f = (p1 - p0) > 1e-5 ? (lum - p0) / (p1 - p0) : 0.0;
          mapped = mix(stopColor(i), stopColor(i + 1), f);
          break;
        }
      }
    }
  }
  fragColor0 = vec4(mix(src.rgb, mapped, u_gm_mix), src.a);
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

export const BLOOM_FS = HEAD + `
uniform float u_threshold, u_intensity, u_radius;
void main() {
  vec3 base = texture(u_image0, v_texCoord).rgb;
  vec2 px = u_radius / u_resolution;            // glow radius (px) → uv
  vec3 bloom = vec3(0.0);
  float wsum = 0.0;
  const int N = 64;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ang = float(i) * 2.39996323;          // golden-angle sunflower disc
    vec2 off = vec2(cos(ang), sin(ang)) * sqrt(t) * px;
    vec3 c = texture(u_image0, v_texCoord + off).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 bright = c * smoothstep(u_threshold, u_threshold + 0.2, l);  // bright-pass
    float w = 1.0 - sqrt(t);                     // soft center-weighted kernel
    bloom += bright * w;
    wsum += w;
  }
  bloom /= max(wsum, 1e-4);
  fragColor0 = vec4(clamp(base + bloom * u_intensity, 0.0, 1.0), 1.0);
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
