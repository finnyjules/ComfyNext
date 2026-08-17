// The Gradient Studio fragment shader. One pass synthesizes the whole image:
// for each of up to 2 layers it maps the pixel through the layout, samples the
// bar-depth field + gradient ramp, then blends the layers over the background
// and adds relief. GLSL ES 3.00 (WebGL2). Film grain lives in the shared post
// stack now (Task 8) — see gradientfx/types.ts's ensureConfigDefaults for the
// legacy relief.grain migration and shader_effects/post_grain.frag for the effect.

import { BLEND_LAYERS_GLSL } from '~/lib/studio/blend'

export const GRADIENT_VS = `#version 300 es
out vec2 v_texCoord;
void main() {
  vec2 verts[3] = vec2[](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
  v_texCoord = verts[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(verts[gl_VertexID], 0., 1.);
}`

export const GRADIENT_FS = `#version 300 es
#define LAYER_MAX 6
#define CURVE_MAX 40
precision highp float;
precision highp sampler2DArray;   // ES 3.00 has no default precision for array samplers

in vec2 v_texCoord;
out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_aspect;        // canvas w/h
uniform float u_time;
uniform float u_seed;

uniform float u_layout[LAYER_MAX]; // per-layer effective layout index (see LAYOUT_IDX)
uniform float u_margin;
uniform float u_innerRadius;
uniform vec3  u_bg;
// 1 = write shape COVERAGE into alpha instead of a flat 1.0, so the shared post
// stack's Grain effect can reproduce the coverage gate this shader's own retired
// grain had (the trailing "* cover" factor, "clean background"). post_grain.frag gates on its own
// input alpha, which is the only channel a generic post effect can read, so alpha
// is the transport. Set only when grain is actually running; renderer.ts's
// blitBack() puts alpha back to 1 afterwards, so nothing downstream ever sees it.
// Same trick as the pre-Task-8 u_grainDeferred path, which smuggled cover to the
// blur pass through exactly this channel.
uniform float u_coverAlpha;
uniform float u_relief;
uniform vec3  u_light;         // normalized light dir (x,y in screen plane, z toward viewer)
uniform vec2  u_center;        // radial/orbit origin offset
uniform float u_layerCount;    // 1..LAYER_MAX

// Per-layer params (index 0..LAYER_MAX-1).
uniform float u_count[LAYER_MAX];
uniform float u_dir[LAYER_MAX];        // 0 up,1 right,2 down,3 left
uniform float u_mirrorH[LAYER_MAX];    // fold the image in X
uniform float u_mirrorV[LAYER_MAX];    // fold the image in Y
uniform float u_gradHoriz[LAYER_MAX];  // 1 = gradient ramp runs horizontally, 0 = vertically
uniform float u_gap[LAYER_MAX];
uniform float u_rounding[LAYER_MAX];
uniform float u_mapping[LAYER_MAX];    // 0 across,1 perbar,2 field
uniform float u_steps[LAYER_MAX];
uniform float u_hueDrift[LAYER_MAX];
uniform float u_hueRotate[LAYER_MAX];
uniform float u_sweep[LAYER_MAX];      // radial sweep, fraction 0..1
uniform float u_scrub[LAYER_MAX];
uniform float u_blend[LAYER_MAX];      // 0 normal,1 lighten,2 screen,3 add,4 multiply,5 darken,6 overlay
uniform float u_opacity[LAYER_MAX];
uniform float u_enabled[LAYER_MAX];    // 1 = layer visible, 0 = disabled (skipped)
uniform float u_crisp[LAYER_MAX];      // 1 = crisp bands (sharp seams), 0 = soft-blended columns
uniform float u_rotStep[LAYER_MAX];    // stack: gradient rotation per ring, radians
uniform float u_pivot[LAYER_MAX];      // stack: per-ring center orbit, 0..1
uniform float u_ringScale[LAYER_MAX];  // stack: disc size multiplier (1 = touches edges, >1 fills frame)
uniform float u_ringShape[LAYER_MAX];  // stack: 0 circle, 1 diamond, 2 square
uniform float u_fieldW[LAYER_MAX];     // field texel width per layer (for coord scaling)
uniform float u_rampAngle[LAYER_MAX];     // simple ramp/conic angle, degrees
uniform float u_rampRadius[LAYER_MAX];    // simple radial size
uniform float u_rampShape[LAYER_MAX];     // radial: 1 circle (aspect-corrected), 0 ellipse
uniform float u_rampSweep[LAYER_MAX];     // conic arc, degrees
uniform float u_rampCloseLoop[LAYER_MAX]; // conic: 1 wrap seamless
uniform float u_repeat[LAYER_MAX];        // 0 once, 1 mirror, 2 tile
uniform float u_repeatCount[LAYER_MAX];   // tile/mirror count
uniform float u_curveN[LAYER_MAX];      // curve polyline point count
uniform float u_curveMode[LAYER_MAX];   // 0 along, 1 outward
uniform float u_curveWidth[LAYER_MAX];  // outward glow reach

uniform float u_flowAngle;       // degrees — liquid base gradient dir
uniform float u_flowScale;       // warp noise frequency
uniform float u_flowIntensity;   // displacement (0 = no warp); pre-scaled in JS
uniform float u_flowDistortion;  // iterative curl strength; pre-scaled in JS
uniform float u_flowDetail;      // fbm octaves 1..6
uniform float u_flowDepth;       // liquid fold emboss amount 0..1
uniform float u_flowHighlights;  // liquid bright-side gain 0..1
uniform float u_flowShadows;     // liquid dark-side gain 0..1
uniform float u_flowFoldScale;   // liquid fold frequency
// Living-drift animation: two looping circular offsets injected into the INNER fbm
// layers so the warp field CHURNS/morphs in place (liquify) rather than translating
// rigidly. Both are (0,0) when Flow speed is 0 → the static field is unchanged.
uniform vec2  u_flowAnim1;
uniform vec2  u_flowAnim2;
uniform float u_flowAnimAmt;     // fold-field churn strength (0 when static)
uniform float u_flowGloss;       // liquid specular gloss 0..~1 (0 = matte)
uniform float u_flowVeins;       // liquid marbled veins 0..1 (0 = smooth)
uniform float u_flowVeinScale;   // vein frequency
uniform float u_flowRipple;      // wet-surface caustic shimmer 0..1
uniform float u_flowRefract;     // glassy chromatic refraction 0..1
uniform float u_flowViscosity;   // 0 = turbulent billow, 1 = laminar streaks
uniform float u_flowSwirl;       // extra recursive warp + amplitude (0 = base warp)

// Mesh gradient — up to 16 soft color points, Gaussian-blended per pixel.
uniform float u_meshCount;
uniform vec2  u_meshPos[16];     // point positions, 0..1
uniform vec3  u_meshCol[16];     // point colors, 0..1 rgb
uniform float u_meshRadius;      // Gaussian bleed radius
uniform float u_meshContrast;    // 0 = smooth blend, 1 = crisp Voronoi cells
uniform float u_meshBlur;        // post-blur radius (screen-space); 0 = sharp

uniform sampler2DArray u_fields;
uniform sampler2DArray u_ramps;
uniform sampler2DArray u_curves;   // per-layer curve polyline: RG=xy, B=cumLen

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

// Value noise + fbm for the domain warp (liquid flow). Independent of the grain hash.
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, float oct) {
  float sum = 0.0, amp = 0.5, tot = 0.0;
  for (int k = 0; k < 6; k++) {
    if (float(k) >= oct) break;
    sum += amp * vnoise(p); tot += amp; p *= 2.0; amp *= 0.5;
  }
  return tot > 0.0 ? sum / tot : 0.0;
}
// Quintic-smoothed (Perlin fade) value noise. Unlike the cubic vnoise above it is
// C2, so its GRADIENT is continuous — the Depth emboss takes a finite-difference
// normal of this field, and cubic's C0 gradient faceted along the noise lattice
// (the blocky "low-res" look). Used for the fold HEIGHT only, so the domain-warp
// composition (applyFlow) of existing gradients is unchanged.
float vnoise5(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm5(vec2 p, float oct) {
  float sum = 0.0, amp = 0.5, tot = 0.0;
  for (int k = 0; k < 6; k++) {
    if (float(k) >= oct) break;
    sum += amp * vnoise5(p); tot += amp; p *= 2.0; amp *= 0.5;
  }
  return tot > 0.0 ? sum / tot : 0.0;
}
// Domain-warp the sample coord (Inigo-Quilez fbm-of-fbm). No-op when intensity is 0.
vec2 applyFlow(vec2 p) {
  if (u_flowIntensity <= 0.0) return p;
  vec2 sp = p * u_flowScale; sp.x *= u_aspect;
  // Viscosity: compress the noise lattice ALONG the flow direction so features
  // stretch into long laminar streaks (honey/syrup) instead of round turbulent puffs.
  if (u_flowViscosity > 0.0) {
    float a = u_flowAngle * PI / 180.0;
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(sp, dir);
    vec2 perp = sp - dir * along;
    sp = dir * (along * (1.0 - u_flowViscosity * 0.78)) + perp;
  }
  // Living drift: the two circular offsets (u_flowAnim1/2, zero when static) push
  // the INNER fbm layers along their own looping paths — because q feeds r's sample
  // point, the composed warp evolves/churns in place instead of sliding as one block.
  vec2 c1 = u_flowAnim1, c2 = u_flowAnim2;
  vec2 q = vec2(fbm(sp + c1, u_flowDetail), fbm(sp + vec2(5.2, 1.3) - c1, u_flowDetail));
  vec2 r = vec2(fbm(sp + u_flowDistortion * q + vec2(1.7, 9.2) + c2, u_flowDetail),
                fbm(sp + u_flowDistortion * q + vec2(8.3, 2.8) - c2, u_flowDetail));
  // Swirl: fold the field into itself with an extra warp pass for gnarlier curls,
  // then boost the displacement — "more warp" without just smearing to mush.
  if (u_flowSwirl > 0.0) {
    vec2 s = vec2(fbm(sp + u_flowDistortion * r * 2.0 + vec2(2.3, 7.4) + c2, u_flowDetail),
                  fbm(sp + u_flowDistortion * r * 2.0 + vec2(9.1, 3.6) - c2, u_flowDetail));
    r = mix(r, s, clamp(u_flowSwirl, 0.0, 1.0));
  }
  vec2 disp = (r - 0.5) * u_flowIntensity * (1.0 + u_flowSwirl * 1.5);
  disp.x /= u_aspect;
  return p + disp;
}
// Scalar fold height for the liquid Depth & Light shading. Uses the quintic fbm so
// the emboss normal (its finite-difference gradient) is smooth, not lattice-faceted.
// When Flow speed > 0, an animated domain warp (gated by u_flowAnimAmt, 0 when
// static) makes the folds CHURN in place rather than translate — matching the warp.
float flowHeight(vec2 p) {
  vec2 sp = p * u_flowFoldScale; sp.x *= u_aspect;
  if (u_flowAnimAmt > 0.0) {
    vec2 w = vec2(fbm5(sp + u_flowAnim1, u_flowDetail), fbm5(sp - u_flowAnim2, u_flowDetail));
    sp += (w - 0.5) * u_flowAnimAmt;
  }
  return fbm5(sp, u_flowDetail);
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
  // Field is stored left-aligned in a 256-wide array layer; scale the sample coord
  // by u_fieldW[i]/256 so texel centers still return exact bar values (see renderer).
  float sx = clamp(x, 0.0, 1.0) * (u_fieldW[i] / 256.0);
  return textureLod(u_fields, vec3(sx, 0.5, float(i)), 0.0).r;
}
vec3 sampleRamp(int i, float t) {
  return textureLod(u_ramps, vec3(clamp(t, 0.0, 1.0), 0.5, float(i)), 0.0).rgb;
}
// Per-stop alpha carried in the ramp LUT's A channel (0..1). Layers with transparent
// stops let the layers/background below show through — so stacked gradients combine.
float sampleAlpha(int i, float t) {
  return textureLod(u_ramps, vec3(clamp(t, 0.0, 1.0), 0.5, float(i)), 0.0).a;
}
// Exact texel fetch of the curve polyline (RGBA32F, NEAREST). texel k of layer i.
vec4 curveTexel(int i, int k) { return texelFetch(u_curves, ivec3(k, 0, i), 0); }

float quantize(float t, float steps) {
  if (steps < 1.0) return t;
  return floor(clamp(t, 0.0, 1.0) * steps) / max(steps - 1.0, 1.0);
}

// Mesh field color at a point: Gaussian-weight every color point by distance, then
// pull toward the nearest point's color by contrast. Uniforms are global so this can
// be sampled multiple times (for the post-blur).
vec3 meshColorAt(vec2 p) {
  int mc = int(u_meshCount + 0.5);
  float r2 = max(u_meshRadius * u_meshRadius, 1e-4);
  vec3 acc = vec3(0.0); float wsum = 0.0; float maxW = -1.0; vec3 nearCol = u_bg;
  for (int k = 0; k < 16; k++) {
    if (k >= mc) break;
    vec2 d = p - u_meshPos[k]; d.x *= u_aspect;
    float w = exp(-dot(d, d) / r2);
    acc += u_meshCol[k] * w; wsum += w;
    if (w > maxW) { maxW = w; nearCol = u_meshCol[k]; }
  }
  vec3 mcol = wsum > 0.0 ? acc / wsum : u_bg;
  return mix(mcol, nearCol, clamp(u_meshContrast, 0.0, 1.0));
}

// Repeat transform for the gradient ramp coordinate t — verbatim twin of repeat.ts's
// applyRepeat (TS is authoritative; the two MUST stay behaviourally identical).
// mode: 0 once, 1 mirror, 2 tile.
float applyRepeat(float t, float mode, float count) {
  if (mode < 0.5) return t;                                         // once
  float n = max(1.0, count);
  if (mode < 1.5) return 1.0 - abs(fract(t * n * 0.5) * 2.0 - 1.0);  // mirror (reflect)
  return fract(t * n);                                               // tile
}

// Returns layer color in .rgb and coverage alpha in .a.
vec4 computeLayer(int i, vec2 p) {
  float count = max(1.0, u_count[i]);
  float gap = u_gap[i];
  float mapping = u_mapping[i];
  bool mirrorH = u_mirrorH[i] > 0.5;
  bool mirrorV = u_mirrorV[i] > 0.5;
  bool gradHoriz = u_gradHoriz[i] > 0.5;

  // ---- Simple primitives (ramp 6 / radialRamp 7 / conic 8): a clean parametric
  // t → LUT. Tested ABOVE the existing ladder so indices 6-8 never fall into mesh.
  if (u_layout[i] > 5.5) {
    float t;
    if (u_layout[i] < 6.5) {                    // ramp — angled linear
      float a = u_rampAngle[i] * PI / 180.0;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 pc = p - 0.5; pc.x *= u_aspect;
      t = dot(pc, dir) + 0.5;
    } else if (u_layout[i] < 7.5) {             // radialRamp — centre-out
      vec2 d = p - 0.5 - u_center;
      if (u_rampShape[i] > 0.5) d.x *= u_aspect;   // circle: aspect-correct
      float r = length(d) * 2.0 / max(u_rampRadius[i], 0.001);
      t = (r - u_innerRadius) / max(1.0 - u_innerRadius, 0.001);
    } else if (u_layout[i] < 8.5) {             // conic — angular sweep
      vec2 d = p - 0.5 - u_center; d.x *= u_aspect;
      float ang = fract(atan(d.y, d.x) / TAU + 0.5 - u_rampAngle[i] / 360.0);
      float sweep = clamp(u_rampSweep[i] / 360.0, 0.05, 1.0);
      t = ang / sweep;
      if (u_rampCloseLoop[i] > 0.5) t = 1.0 - abs(fract(t) * 2.0 - 1.0); // wrap seamless
    } else {                                 // curve (9) — gradient follows a bezier
      // p is v_texCoord (0..1); curve texels are in the SAME space (upload flips Y).
      int n = int(u_curveN[i] + 0.5);
      float bestD = 1e9; float bestS = 0.0;
      vec4 first = curveTexel(i, 0);
      vec2 prev = first.xy; float prevL = first.z;
      for (int k = 1; k < CURVE_MAX; k++) {
        if (k >= n) break;
        vec4 cur = curveTexel(i, k);
        vec2 a = prev, b = cur.xy;
        vec2 ab = b - a; vec2 ap = p - a;
        float u = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        vec2 proj = a + ab * u;
        vec2 dd = proj - p; dd.x *= u_aspect;          // aspect-correct the DISTANCE
        float dist = length(dd);
        if (dist < bestD) { bestD = dist; bestS = mix(prevL, cur.z, u); }
        prev = b; prevL = cur.z;
      }
      t = (u_curveMode[i] < 0.5)
        ? bestS                                        // along = arc-length param
        : clamp(bestD / max(u_curveWidth[i], 1e-3), 0.0, 1.0); // outward = distance
    }
    t = applyRepeat(t, u_repeat[i], u_repeatCount[i]);
    t = clamp(t, 0.0, 1.0);
    t += u_hueDrift[i] / 360.0 * (t - 0.5);  // parity with other branches' drift use
    t = quantize(t, u_steps[i]);
    vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
    return vec4(col, sampleAlpha(i, t));
  }

  // ---- Mesh: soft point mesh (see meshColorAt). p is already domain-warped, so the
  // warp ripples the blobs for free. The optional post-blur averages the field over a
  // two-ring tap pattern for a dreamy wash.
  if (u_layout[i] > 4.5) {
    vec3 mcol;
    if (u_meshBlur > 0.0001) {
      // Three rings, each rotated a third of a step off the last, so the taps spiral
      // instead of lining up into 8 lobes at wide radii. Ring radii are spaced by
      // sqrt to keep the sample density roughly even across the disc.
      // Per-pixel rotation of the whole pattern: on a high-contrast (near-Voronoi)
      // field a fixed tap set steps in discrete jumps and reads as radial spokes.
      // Jittering turns that banding into fine noise the grain pass hides.
      float jit = hashGrain(gl_FragCoord.xy) * TAU;
      vec3 sum = meshColorAt(p); float wsum = 1.0;
      for (int t = 0; t < 8; t++) {
        float a = float(t) / 8.0 * TAU + jit;
        for (int r = 0; r < 3; r++) {
          float rf = sqrt((float(r) + 1.0) / 3.0);
          float ao = a + float(r) / 24.0 * TAU;
          vec2 dir = vec2(cos(ao), sin(ao)); dir.x /= u_aspect;
          sum += meshColorAt(p + dir * u_meshBlur * rf); wsum += 1.0;
        }
      }
      mcol = sum / wsum;
    } else {
      mcol = meshColorAt(p);
    }
    return vec4(rotateHue(mcol, u_hueRotate[i]), 1.0);
  }

  // ---- Liquid: no bars; sample the ramp along the (already-warped) angle gradient.
  if (u_layout[i] > 3.5) {
    float a = u_flowAngle * PI / 180.0;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 pc = p - 0.5; pc.x *= u_aspect;

    // Fold field + slope, shared by depth refraction, veins and chromatic refraction
    // below (computed once, and only when something actually needs it).
    bool needH = (u_flowVeins > 0.0 || u_flowDepth > 0.001 || u_flowRefract > 0.0);
    bool needG = (u_flowDepth > 0.001 || u_flowRefract > 0.0);
    float h0 = needH ? flowHeight(p) : 0.0;
    vec2 g = vec2(0.0);
    if (needG) {
      float e = 1.5 / u_resolution.y;
      g = vec2(flowHeight(p + vec2(e, 0.0)) - h0, flowHeight(p + vec2(0.0, e)) - h0) / e;
    }

    float t = dot(pc, dir) + 0.5;
    // Depth refraction: bend the gradient through the 3D fold relief so the colours
    // drape/refract over the folds instead of lying flat under the shading. Same
    // fold-scale compensation as the emboss; scales with Depth, 0 when Depth is 0.
    if (u_flowDepth > 0.001) t += dot(g * (7.0 / u_flowFoldScale), dir) * u_flowDepth * 0.3;
    t = clamp(t, 0.0, 1.0);

    // Marbled veins: displace the coordinate by turbulence, then fold it through a
    // triangle wave so the ramp repeats into ink/oil tendrils (seamless: ramp 0→1→0).
    if (u_flowVeins > 0.0) {
      float m = t + (h0 - 0.5) * 1.6;
      float tri = abs(fract(m * u_flowVeinScale) * 2.0 - 1.0);
      t = mix(t, tri, u_flowVeins);
    }
    t = quantize(t, u_steps[i]);

    // Chromatic refraction: split the ramp coordinate per channel by the local slope —
    // a glassy chromatic edge along the veins, as if seen through thick liquid.
    if (u_flowRefract > 0.0) {
      float disp = u_flowRefract * 0.045 * length(g);
      vec3 cr = sampleRamp(i, clamp(t + disp, 0.0, 1.0));
      vec3 cg = sampleRamp(i, t);
      vec3 cb = sampleRamp(i, clamp(t - disp, 0.0, 1.0));
      return vec4(rotateHue(vec3(cr.r, cg.g, cb.b), u_hueRotate[i]), sampleAlpha(i, t));
    }
    return vec4(rotateHue(sampleRamp(i, t), u_hueRotate[i]), sampleAlpha(i, t));
  }

  // ---- Stack: N concentric circles of shrinking radius, each filled with the same ramp
  // gradient rotated by ring*rotStep. The visible pixel takes the SMALLEST circle that
  // contains it (drawn last/on top). A per-ring center orbit (pivot) makes the off-centre
  // spiral core. The rotating gradient alone fakes the 3D ripple.
  if (u_layout[i] > 2.5) {
    int rings = int(count + 0.5);
    vec2 q = p - 0.5; q.x *= u_aspect;
    float maxR = max(0.05, (0.5 - u_margin) * max(0.1, u_ringScale[i]));
    float t = -1.0;
    for (int k = 39; k >= 0; k--) {
      if (k >= rings) continue;
      float f = rings > 1 ? float(k) / float(rings - 1) : 0.0;
      float r = maxR * (1.0 - f * 0.92);
      float ang = float(k) * u_rotStep[i];
      float ca = cos(ang), sa = sin(ang);
      vec2 c = vec2(ca, sa) * (u_pivot[i] * maxR * f);
      vec2 d = q - c;
      vec2 dr = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);  // d rotated by -ang (shape + gradient rotate together)
      // Ring contour distance: circle = Euclidean, diamond = Manhattan, square = Chebyshev.
      float shp = u_ringShape[i];
      float dist = shp > 1.5 ? max(abs(dr.x), abs(dr.y))
                 : shp > 0.5 ? abs(dr.x) + abs(dr.y)
                 : length(dr);
      if (dist <= r) {
        float ly = dr.y;                               // gradient runs along the ring's local vertical
        t = clamp(ly / (2.0 * r) + 0.5, 0.0, 1.0);
        break;
      }
    }
    if (t < 0.0) return vec4(0.0);                      // outside every ring → background
    t = quantize(t, u_steps[i]);
    vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
    return vec4(col, sampleAlpha(i, t));
  }

  if (u_layout[i] < 0.5) {
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
    return vec4(col, colMask * sampleAlpha(i, t));
  }

  // ---- Radial / Orbit: the linear band model wrapped into polar coords. The
  // field offsets the gradient per band → a circular wave. Radial = angular bands
  // with a radial gradient; Orbit = concentric ring bands with an angular gradient.
  bool orbit = u_layout[i] > 1.5;
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
  return vec4(col, colMask * sampleAlpha(i, t));
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

  if (u_layout[i] < 0.5) {
    float m = u_margin;
    vec2 uv = (q - m) / max(1.0 - 2.0 * m, 0.001);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    if (mirrorH) uv.x = 1.0 - abs(2.0 * uv.x - 1.0);
    if (mirrorV) uv.y = 1.0 - abs(2.0 * uv.y - 1.0);
    int dir = int(u_dir[i] + 0.5);
    bool vertBands = (dir == 0 || dir == 2);
    band = vertBands ? uv.x : uv.y;
  } else {
    bool orbit = u_layout[i] > 1.5;
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

${BLEND_LAYERS_GLSL}

void main() {
  vec2 p = v_texCoord;
  // Domain-warped coord (identity when intensity 0). Clamp to the frame so a strong
  // warp on a bounded layout (linear/radial/stack) smears the edge colour inward
  // instead of pushing samples off-frame into background voids. At intensity 0 the
  // warp returns p (already in [0,1]) so the clamp is a no-op — existing gradients
  // stay byte-identical.
  vec2 pw = clamp(applyFlow(p), 0.0, 1.0);

  // Composite the enabled layers in order. A disabled layer (u_enabled 0) is
  // skipped entirely; the FIRST enabled layer becomes the base (composited over
  // the background with no opacity), the rest blend over it — so disabling layer 0
  // promotes the next enabled layer to base, matching the shader studio's chain.
  vec3 col = u_bg;
  float cover = 0.0;
  bool baseDone = false;
  for (int i = 0; i < LAYER_MAX; i++) {
    if (float(i) > u_layerCount - 0.5) break;
    if (u_enabled[i] < 0.5) continue;
    vec4 li = computeLayer(i, pw);
    if (!baseDone) {
      col = mix(col, li.rgb, li.a);
      cover = li.a;
      baseDone = true;
    } else {
      vec3 b = blendLayers(col, li.rgb, u_blend[i]);
      float a = li.a * u_opacity[i];
      col = mix(col, b, a);
      cover = max(cover, a);
    }
  }

  // 3D relief: light the band/ring height-field of layer 0 (the primary structure).
  // Finite-difference normal from bandHeight, Lambert-shaded against u_light. Sidesteps
  // dFdx, which is undefined here because bandHeight early-returns at the mask edges.
  if (u_relief > 0.001 && u_layout[0] < 3.5 && u_enabled[0] > 0.5) {
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

  // Liquid Depth & Light: emboss from the flow fold field (its own light, not u_light).
  // Gated to the liquid layout (4) so it never touches mesh (5). Gloss adds a wet
  // Blinn-Phong sheen on the fold normal for an oily/glossy liquid look.
  if (u_layout[0] > 3.5 && u_layout[0] < 4.5 && (u_flowDepth > 0.001 || u_flowGloss > 0.001)) {
    float e = 1.5 / u_resolution.y;
    float h  = flowHeight(p);
    float hx = flowHeight(p + vec2(e, 0.0));
    float hy = flowHeight(p + vec2(0.0, e));
    // Frequency-compensate the slope: the fold gradient scales with u_flowFoldScale,
    // so low fold scales embossed flat/soft ("blurry") while only the top of the
    // range looked crisp. Normalize to that top (max u_flowFoldScale = 7.0) so Depth
    // reads equally defined at EVERY fold scale.
    float fcomp = 7.0 / u_flowFoldScale;
    vec3 n = normalize(vec3(-(hx - h) / e * fcomp, -(hy - h) / e * fcomp, 1.0 / max(u_flowDepth, 0.05)));
    vec3 L = normalize(vec3(0.4, 0.5, 0.8));
    float d = clamp(dot(n, L), 0.0, 1.0);
    if (u_flowDepth > 0.001) {
      float gain = d > 0.5 ? u_flowHighlights : u_flowShadows;
      float shade = 1.0 + (d - 0.5) * 2.0 * gain;
      col *= clamp(shade, 0.0, 2.0);
    }
    if (u_flowGloss > 0.001) {
      vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));   // half-vector (viewer on +Z)
      float spec = pow(clamp(dot(n, H), 0.0, 1.0), 48.0);
      col += spec * u_flowGloss;                     // white wet sheen
    }
  }

  // Wet ripples: a thin interference/caustic pattern phase-shifted by the fold field,
  // reading as light dancing on a liquid surface. Liquid-only; animated via the fold churn.
  if (u_layout[0] > 3.5 && u_layout[0] < 4.5 && u_flowRipple > 0.001) {
    vec2 rp = p; rp.x *= u_aspect;
    rp *= (6.0 + u_flowRipple * 14.0);
    float ph = flowHeight(p) * TAU;
    float c = sin(rp.x + ph) * sin(rp.y * 1.3 - ph);
    c = pow(max(c, 0.0), 8.0);
    col += c * u_flowRipple * 0.5;
  }

  // Film grain retired (Task 8) — moved into the shared post stack's own Grain
  // effect (shader_effects/post_grain.frag, applied by gradientfx/renderer.ts's
  // applyPost() call after this pass). The retired formula was
  // "col += g * u_grain * 0.16 * cover * midtone" — the "cover" factor kept grain
  // off the clean background, which matters for every layout where coverage is
  // less than 1 (orbit/radial/stack with margin, innerRadius or gap). That gate is
  // preserved by handing "cover" to the post stack in alpha; see u_coverAlpha.
  fragColor = vec4(clamp(col, 0.0, 1.0), u_coverAlpha > 0.5 ? cover : 1.0);
}`

// ─────────────────────────────────────────────────────────────────────────────
// Soft-focus / depth-of-field POST pass. Runs only when focus.blur > 0: the main
// shader renders to a texture, then this pass samples it with a golden-angle disc
// kernel whose radius is scaled per-pixel by a focus mask (0 = sharp, 1 = full
// blur). Shape 0 = uniform (blur everything), 1 = radial spot, 2 = linear band.
// Reuses GRADIENT_VS (fullscreen triangle → v_texCoord).
// ─────────────────────────────────────────────────────────────────────────────
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_src;
uniform vec2  u_resolution;
uniform float u_blur;         // max radius as a fraction of min(res) — 0 = off
uniform float u_focusShape;   // 0 uniform, 1 radial, 2 linear
uniform vec2  u_focusCenter;  // −0.5..0.5
uniform float u_focusRadius;  // in-focus size, 0..1
uniform float u_focusSoft;    // falloff, 0..1
uniform float u_focusAngle;   // radians (linear band)
uniform float u_coverAlpha;   // 1 = forward the main pass's coverage in alpha (see GRADIENT_FS)

const float GOLDEN = 2.3999632;   // golden angle (rad)
const int   TAPS   = 28;

// Cheap hash → per-pixel spiral rotation, so the fixed kernel doesn't stamp a
// visible orientation into the blur.
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// 0 = fully sharp (inside focus), 1 = fully blurred. Aspect-corrected so a radial
// focus reads round on non-square canvases.
float focusMask(vec2 uv){
  vec2 p = uv - 0.5 - u_focusCenter;
  p.x *= u_resolution.x / u_resolution.y;
  float d;
  if (u_focusShape < 1.5) {
    d = length(p);                                   // radial: distance from centre
  } else {
    vec2 dir = vec2(cos(u_focusAngle), sin(u_focusAngle));
    d = abs(dot(p, vec2(-dir.y, dir.x)));            // linear: perpendicular distance
  }
  float soft = max(u_focusSoft, 0.001);
  return smoothstep(u_focusRadius, u_focusRadius + soft, d);
}

void main(){
  vec4 src = texture(u_src, v_texCoord);
  float mask = (u_focusShape < 0.5) ? 1.0 : focusMask(v_texCoord);
  float radius = u_blur * min(u_resolution.x, u_resolution.y) * mask;   // pixels

  vec3 outc;
  if (radius < 0.6) {
    outc = src.rgb;                                   // in-focus / sharp
  } else {
    vec2 texel = 1.0 / u_resolution;
    vec3 sum = src.rgb;
    float wsum = 1.0;
    float ang = hash(gl_FragCoord.xy) * 6.2831853;
    for (int i = 1; i <= TAPS; i++) {
      float t = float(i) / float(TAPS);
      float r = sqrt(t) * radius;                     // even coverage over the disc
      ang += GOLDEN;
      vec2 off = vec2(cos(ang), sin(ang)) * r * texel;
      sum += texture(u_src, v_texCoord + off).rgb;
      wsum += 1.0;
    }
    outc = sum / wsum;
  }

  // Grain retired from this pass (Task 8) — the shared post stack's Grain effect
  // now runs AFTER this blur pass (applyPost(), called from renderer.ts's render()
  // once this canvas holds the final pixels), which already guarantees grain stays
  // crisp on top of the blur without a deferred re-apply here. What this pass still
  // does for grain is forward the main pass's smuggled shape coverage (src.a, the
  // UNBLURRED centre tap — exactly what the old deferred-grain code gated on) so
  // the coverage gate survives the blur path too. See GRADIENT_FS's u_coverAlpha.
  fragColor = vec4(clamp(outc, 0.0, 1.0), u_coverAlpha > 0.5 ? src.a : 1.0);
}`
