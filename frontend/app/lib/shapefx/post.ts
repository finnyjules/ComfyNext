import type { ShapeConfig } from './config'

/** True when the post pass would do anything. When false the engine renders straight to
 *  the canvas with no render target — matching the old overlay's `filter: none` skip. */
export function postNeeded(cfg: ShapeConfig): boolean {
  return (cfg.style.grain ?? 0) > 0 || (cfg.style.distortion ?? 0) > 0
}

export const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const POST_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform float uGrain;        // 0..1
uniform float uDistort;      // 0..1
uniform vec2  uResolution;
uniform float uSeed;

// Shared with gradientfx/shaders.ts — same hash so grain reads identically across studios.
float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec2 uv = vUv;
  // Displacement: two decorrelated noise fields drive x/y, scaled to a pixel budget that
  // matches the old SVG filter's (distortion/100)*45px.
  if (uDistort > 0.0) {
    float n1 = vnoise(uv * 6.0 + uSeed);
    float n2 = vnoise(uv * 6.0 - uSeed + 17.3);
    vec2 px = (vec2(n1, n2) - 0.5) * (uDistort * 45.0);
    uv += px / uResolution;
  }
  vec4 src = texture2D(uScene, clamp(uv, 0.0, 1.0));
  vec3 col = src.rgb;
  // Grain: luminance-shaped so it sits in the midtones, same formula as gradientfx.
  if (uGrain > 0.0) {
    float g = hashGrain(gl_FragCoord.xy + uSeed) - 0.5;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float midtone = 0.35 + 0.65 * (lum * (1.0 - lum) * 4.0);
    col += g * uGrain * 0.5 * midtone;
  }
  vec3 outCol = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(outCol, src.a);
}
`
