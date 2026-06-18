#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uniform float u_refraction;  // cylindrical-lens bend within each flute (glass look)
uniform float u_count;       // number of flutes/rings across the image
uniform float u_depth;       // rib-seam darkness (0 = flat, 1 = black seams)
uniform float u_shadeWidth;  // bright-crest width as a fraction of the flute (0..1)
uniform float u_chromatic;   // per-channel dispersion, strongest at flute edges
uniform float u_blur;        // softening smear length along the flutes
uniform float u_mode;        // 0 = linear flutes, 1 = concentric rings
uniform float u_angle;       // flute angle in degrees (linear mode; 90 = vertical)
uniform float u_centerX;     // ring centre (concentric mode)
uniform float u_centerY;

const float PI = 3.14159265359;
const int N = 16;

void main() {
    float aspect = u_resolution.x / max(u_resolution.y, 1.0);
    vec2 s = vec2(v_texCoord.x * aspect, v_texCoord.y);   // square (aspect-corrected) space

    // Across-flute coordinate + unit basis (across = refraction axis, along = smear axis),
    // all in square space so flute spacing and rings are even on non-square images.
    float across;
    vec2 acrossUnit, alongUnit;
    if (u_mode > 0.5) {
        vec2 c = vec2(u_centerX * aspect, u_centerY);
        vec2 d = s - c;
        float r = length(d);
        across = r;
        acrossUnit = (r > 1e-5) ? d / r : vec2(1.0, 0.0);      // radial
        alongUnit = vec2(-acrossUnit.y, acrossUnit.x);          // tangential
    } else {
        float a = radians(u_angle);
        acrossUnit = vec2(-sin(a), cos(a));
        alongUnit = vec2(cos(a), sin(a));
        across = dot(s, acrossUnit);
    }

    float cell = across * u_count;
    float fc = fract(cell) - 0.5;                              // -0.5..0.5 within the flute

    // Cylindrical-lens refraction: displace the sample across the flute (square space → texcoord).
    vec2 moveS = acrossUnit * (u_refraction * fc / max(u_count, 1.0));
    vec2 base = v_texCoord + vec2(moveS.x / aspect, moveS.y);

    // Directional softening along the flute + chromatic dispersion that grows toward the ribs.
    float cr = u_chromatic * fc * 2.0;
    vec2 crMove = acrossUnit * cr;
    vec2 crTex = vec2(crMove.x / aspect, crMove.y);
    vec3 col = vec3(0.0);
    for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1) - 0.5;
        vec2 mS = alongUnit * (t * u_blur);
        vec2 off = vec2(mS.x / aspect, mS.y);
        col.r += texture(u_image0, clamp(base + off + crTex, 0.0, 1.0)).r;
        col.g += texture(u_image0, clamp(base + off, 0.0, 1.0)).g;
        col.b += texture(u_image0, clamp(base + off - crTex, 0.0, 1.0)).b;
    }
    col /= float(N);

    // Rib shading: bright crest centred on the flute, dark seams at the ribs.
    // u_shadeWidth sets the crest width (fraction of the flute that stays bright).
    float dist = abs(fc) * 2.0;                                // 0 at crest, 1 at rib
    float ridge = 1.0 - smoothstep(u_shadeWidth - 0.12, u_shadeWidth + 0.12, dist);
    ridge = mix(1.0 - u_depth, 1.0, ridge);

    fragColor0 = vec4(col * ridge, 1.0);
}
