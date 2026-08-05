#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

// Film grain — the `grain` post effect. Ported from hashGrain in
// frontend/app/lib/gradientfx/shaders.ts:104-108 (Dave Hoskins "Hash without
// Sine") and its luminance-shaped midtone bias at shaders.ts:634-637, with the
// same canonical 0.16 coefficient, so Task 8's migrated Gradient documents
// render unchanged.
uniform float u_amount;      // 0..1, how strong the grain is
uniform float u_size;        // 1..8, how coarse the grain is (device px per cell)
// The alpha gate: chain.ts always sets this to 1.0 for this alphaGated effect.
// Multiplying by it (rather than assuming it) means a caller that forgets to
// wire it gets a defaulted-0 uniform — no grain at all — rather than grain
// silently leaking onto transparent background. Replaces Gradient's `cover`
// plumbing (frontend/app/lib/gradientfx/shaders.ts:633,637,640-642).
uniform float u_alphaGate;

float hashGrain(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

void main() {
    vec4 src = texture(u_image0, v_texCoord);

    // Sampled per DEVICE PIXEL (gl_FragCoord), same as the ported formula, so a
    // coarseness of 1 reproduces the original bit-for-bit. Larger u_size groups
    // pixels into coarser cells for a chunkier grain.
    vec2 coord = u_size > 1.0 ? floor(gl_FragCoord.xy / u_size) * u_size : gl_FragCoord.xy;
    float g = hashGrain(coord + u_seed) - 0.5;

    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    float midtone = 0.35 + 0.65 * (lum * (1.0 - lum) * 4.0);   // 0.35 floor .. 1 at lum 0.5
    float gate = u_alphaGate * src.a;   // never lands on transparent background

    vec3 col = src.rgb + g * u_amount * 0.16 * midtone * gate;
    fragColor0 = vec4(clamp(col, 0.0, 1.0), src.a);
}
