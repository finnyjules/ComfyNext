/**
 * Depth-of-field pass — shaped-aperture, linear-light defocus driven by a depth map.
 *
 * The linear-light accumulation with a highlight boost is the whole feature. Blur in
 * display gamma and bright out-of-focus points average away into grey mush ("blurry
 * photo"); boost them in linear light before accumulating and they become glowing discs
 * ("depth of field"). That is the single difference, and it is why the boost happens
 * BEFORE `acc +=`, not after.
 *
 * Depth convention: BRIGHT = NEAR (the model emits inverse depth / disparity, not
 * distance). So focus = 1 is the nearest plane.
 *
 * Known limitation, accepted for v1: occlusion bleed is mitigated — taps are weighted by
 * whether their own CoC reaches the centre pixel, which softens the dark halo on
 * foreground edges — but not solved. A correct fix needs layer separation, because the
 * pixels behind a blurred foreground object were never captured.
 */
import { apertureOffsets, apertureRadiusPx, cocFor } from './dofMath'
import { GpuPost } from './gpuPost'
import type { DofEffect } from './postEffects'

/** Tap count. Fixed so the shader's uOffsets array can be statically sized.
 *  48 + per-pixel spiral rotation; at 32 with no rotation the individual samples are
 *  visible as dots rather than reading as a continuous disc. */
export const DOF_TAPS = 48

export const DOF_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform float uFocus;
uniform float uRange;
uniform float uRadius;          // max blur radius, in UV units
uniform float uBloomThreshold;
uniform float uBloomStrength;
uniform int   uTapCount;
uniform vec2  uOffsets[${DOF_TAPS}];

vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c)   { return pow(c, vec3(1.0 / 2.2)); }

float coc(float depth) {
  return clamp(abs(depth - uFocus) - uRange * 0.5, 0.0, 1.0);
}

// Deterministic per-pixel hash. Depends only on fragment position, so it is stable
// across frames — a time-varying or random jitter would make baked motion shimmer.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 center = texture(uColor, vUv);
  float centerCoc = coc(texture(uDepth, vUv).r);
  float radius = centerCoc * uRadius;

  // Rotate the tap spiral by a per-pixel angle. Without this the finite tap set is
  // visible as discrete dots inside every bokeh disc; with it the sampling error
  // becomes fine noise, which reads as a continuous disc.
  float a = hash12(gl_FragCoord.xy) * 6.2831853;
  float ca = cos(a), sa = sin(a);
  mat2 jitter = mat2(ca, -sa, sa, ca);

  vec3 acc = vec3(0.0);
  float wsum = 0.0;

  for (int i = 0; i < ${DOF_TAPS}; i++) {
    if (i >= uTapCount) break;
    vec2 uv = vUv + (jitter * uOffsets[i]) * radius;
    vec3 c = toLinear(texture(uColor, uv).rgb);

    // Highlight boost BEFORE accumulation — this is what makes bokeh discs.
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    if (lum > uBloomThreshold) {
      c *= 1.0 + uBloomStrength * (lum - uBloomThreshold);
    }

    // Mitigate bleed: a sharp sample should not smear onto a blurred centre.
    float sampleCoc = coc(texture(uDepth, uv).r);
    float w = mix(0.15, 1.0, clamp(sampleCoc / max(centerCoc, 1e-4), 0.0, 1.0));

    acc += c * w;
    wsum += w;
  }

  vec3 outc = wsum > 0.0 ? acc / wsum : toLinear(center.rgb);
  fragColor = vec4(toSrgb(outc), center.a);
}`

let pass: GpuPost | null = null
const getPass = () => (pass ??= new GpuPost(DOF_FRAG))

/** Whether the pass should run at all. Pure, so the skip logic is unit-testable. */
export function dofShouldRun(fx: DofEffect, hasDepth: boolean): boolean {
  return fx.visible !== false && fx.aperture > 0 && hasDepth
}

export function dofAvailable(): boolean {
  return getPass().available()
}

/** Why DOF is unavailable — shown in the panel. Never silently substituted. */
export function dofUnavailableReason(): string {
  return getPass().unavailableReason()
}

/** Assertion marker — distinguishes "DOF applied" from "DOF silently skipped". */
export function __dofRuns(): number {
  return getPass().runs
}

/**
 * @param W logical canvas width. `aperture` is normalized to it, so a 2x bake and the
 *          preview produce the same visual blur.
 * @param w,h pixel size of the surface being RENDERED.
 * @param onCanvasW how wide that surface ends up ON the artboard, defaulting to `w`.
 *        These differ for a WIRED layer: the pass runs at the image's native size, but
 *        the image is drawn fitted-and-scaled, so normalizing by `w` would make the blur
 *        track the source file's resolution instead of what you see. A local layer
 *        renders at its on-canvas size, so the default is already correct there.
 */
export function applyDof(
  color: CanvasImageSource,
  depth: CanvasImageSource,
  fx: DofEffect,
  W: number,
  w: number,
  h: number,
  onCanvasW?: number,
): HTMLCanvasElement | null {
  if (!dofShouldRun(fx, true)) return null

  const offsets = apertureOffsets(DOF_TAPS, fx.bladeCount, fx.bladeRotation)
  const flat = new Float32Array(DOF_TAPS * 2)
  offsets.forEach((o, i) => { flat[i * 2] = o.x; flat[i * 2 + 1] = o.y })

  // Radius is normalized to canvas width, then expressed in UV units of this surface —
  // using how wide the surface lands on the artboard, not how many pixels it renders at.
  const radiusUv = apertureRadiusPx(fx.aperture, W) / Math.max(1, onCanvasW ?? w)

  return getPass().render(color, depth, w, h, {
    uFocus: fx.focus,
    uRange: fx.range,
    uRadius: radiusUv,
    uBloomThreshold: fx.bloomThreshold,
    uBloomStrength: fx.bloomStrength,
    uTapCount: DOF_TAPS,
    uOffsets: flat,
  })
}

export { cocFor }
