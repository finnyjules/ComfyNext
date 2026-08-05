import type { ShapeConfig } from './config'

/** True when the post pass would do anything. When false the engine renders straight to
 *  the canvas with no render target — matching the old overlay's `filter: none` skip.
 *
 * Grain's own NOISE is retired from this pass (Task 8 — moved into the shared post
 * stack; see config.ts's mergeConfig). What replaced grain in this check is NOT a
 * look knob: `forceOffscreenPass` is a compatibility pin (read its doc comment on
 * ShapeConfig). Routing a config through this pass (engine.ts's ensurePost()/
 * offscreen WebGLRenderTarget + blit) instead of straight to the canvas changes the
 * base image itself — no MSAA on that render target vs. the canvas's own
 * antialias:true, sampled through one extra texture round-trip — an existing,
 * orthogonal difference in Shape's render pipeline, unrelated to and out of scope for
 * this task (distortion, which still legitimately needs this pass, has always paid it
 * too). Pre-Task-8 the condition was `style.grain > 0`, and style.grain defaulted to
 * 20, so every saved document took this path; testing distortion alone would have
 * silently moved all of them onto the OTHER, cleaner-looking path — a real, measured
 * appearance change (~40/255 mean pixel diff on a representative fixture) despite the
 * noise math itself being correct.
 *
 * The pin decouples that routing answer from the grain AMOUNT, which is now the
 * user's to change through the shared Grain controls: a migrated document keeps its
 * original path even after its owner turns grain down, off, or up. */
export function postNeeded(cfg: ShapeConfig): boolean {
  return cfg.forceOffscreenPass === true || (cfg.style.distortion ?? 0) > 0
}

export const POST_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const POST_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform float uDistort;      // 0..1
uniform vec2  uResolution;
uniform float uSeed;

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
  vec3 outCol = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(outCol, src.a);
}
`
