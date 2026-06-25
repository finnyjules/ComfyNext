#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uint pcg(uint v) { v = v * 747796405u + 2891336453u; v = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u; return (v >> 22u) ^ v; }
float hash2(vec2 ip, float seed) {
    uvec2 q = uvec2(ivec2(ip) + 32768);
    uint h = pcg(q.x ^ pcg(q.y ^ pcg(uint(int(seed)))));
    return float(h) * (1.0 / 4294967295.0);
}

uniform sampler2D u_glyphs;
uniform sampler2D u_customGlyphs; // runtime 1-row atlas built from user-typed chars (studio only)
uniform float u_glyphCount;
uniform float u_glyphRows;
uniform float u_cell;
uniform float u_jitter;
uniform float u_speed;
uniform float u_colored;
uniform float u_shape;
uniform float u_brightness;
uniform float u_spacing;
uniform float u_invert;
uniform float u_underlay;
uniform float u_blur;

// Anti-aliased "metric <= t" test: 1 inside, 0 outside, smooth ~1px band across
// the edge (fwidth gives the screen-space derivative of the metric, so the AA band
// stays a constant pixel width at any cell size).
float aaInside(float metric, float t) {
    float w = max(fwidth(metric), 1e-4);
    return 1.0 - smoothstep(t - w, t + w, metric);
}

// Geometric coverage: 1 inside the shape, 0 outside. q is centered in [-1,1], t = luminance.
float geoShape(int shp, vec2 q, float t, vec2 cell) {
    if (shp == 0) shp = 1 + int(floor(hash2(cell, u_seed + 7.0) * 6.0)); // Mixed: pick 1..6 per cell
    float r = length(q);
    if (shp == 1) return aaInside(max(abs(q.x), abs(q.y)), t);      // Blocks
    if (shp == 2) return aaInside(r, t);                            // Circles
    if (shp == 3) return aaInside(abs(q.y), t);                     // Lines
    if (shp == 4) return aaInside(abs(q.x - q.y) * 0.70710678, t);  // Diagonal
    if (shp == 5) return aaInside(min(abs(q.x), abs(q.y)), t * 0.5);// Cross
    return aaInside((abs(q.x) + abs(q.y)) * 0.70710678, t);        // Diamond (6)
}

// Atlas geometry. Glyphs are CW x CH, laid out u_glyphCount across x and
// TOTAL_ROWS down y; numpy rows are uploaded Y-flipped for GL convention.
const int CW = 192, CH = 288, TOTAL_ROWS = 7;

// One atlas texel for glyph `gi`, atlas `row`, clamped INSIDE that glyph cell so a
// bilinear tap near an edge never bleeds into the neighbouring glyph or row.
float glyphTexel(int gx, int gy, int gi, int row) {
    gx = clamp(gx, 0, CW - 1);
    gy = clamp(gy, 0, CH - 1);
    int tx = gi * CW + gx;
    int ty = (TOTAL_ROWS - 1 - row) * CH + gy;
    return texelFetch(u_glyphs, ivec2(tx, ty), 0).r;
}

// Bilinear glyph sample: smooth at large cells (no blocky upscale) and at small
// cells (no NEAREST sparkle when the atlas is minified for a fine grid).
float sampleGlyph(int gi, int row, vec2 inCell) {
    if (inCell.x < 0.0 || inCell.x >= 1.0 || inCell.y < 0.0 || inCell.y >= 1.0) return 0.0;
    vec2 p = vec2(inCell.x * float(CW), inCell.y * float(CH)) - 0.5; // -0.5 -> texel centers
    vec2 fp = floor(p);
    vec2 fr = p - fp;
    int x0 = int(fp.x), y0 = int(fp.y);
    float c00 = glyphTexel(x0,     y0,     gi, row);
    float c10 = glyphTexel(x0 + 1, y0,     gi, row);
    float c01 = glyphTexel(x0,     y0 + 1, gi, row);
    float c11 = glyphTexel(x0 + 1, y0 + 1, gi, row);
    return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

// Custom user glyphs: a runtime-built 1-row atlas (COLS glyphs, CW x CH each) the
// Shader Studio rasterizes from typed characters. Same crisp bilinear path as the
// built-in atlas — single row, so there is no row offset.
float customTexel(int gx, int gy, int gi) {
    gx = clamp(gx, 0, CW - 1);
    gy = clamp(gy, 0, CH - 1);
    return texelFetch(u_customGlyphs, ivec2(gi * CW + gx, gy), 0).r;
}
float sampleCustom(int gi, vec2 inCell) {
    if (inCell.x < 0.0 || inCell.x >= 1.0 || inCell.y < 0.0 || inCell.y >= 1.0) return 0.0;
    vec2 p = vec2(inCell.x * float(CW), inCell.y * float(CH)) - 0.5;
    vec2 fp = floor(p);
    vec2 fr = p - fp;
    int x0 = int(fp.x), y0 = int(fp.y);
    float c00 = customTexel(x0,     y0,     gi);
    float c10 = customTexel(x0 + 1, y0,     gi);
    float c01 = customTexel(x0,     y0 + 1, gi);
    float c11 = customTexel(x0 + 1, y0 + 1, gi);
    return mix(mix(c00, c10, fr.x), mix(c01, c11, fr.x), fr.y);
}

// Blur ONLY the underlay source (not the glyph layer). Golden-angle spiral,
// aspect-corrected so the kernel is round, with a per-pixel start-angle jitter so
// the low tap count reads as smooth rather than banded. u_blur is a fraction of
// the image; 0 returns the sharp source untouched.
vec3 sampleBase(vec2 uv) {
    if (u_blur <= 0.0) return texture(u_image0, uv).rgb;
    const int N = 28;
    float radius = u_blur * 0.10;
    float aspect = u_resolution.y / max(u_resolution.x, 1.0);
    float a0 = hash2(floor(uv * u_resolution), u_seed + 19.0) * 6.2831853;
    vec3 sum = vec3(0.0);
    for (int i = 0; i < N; i++) {
        float t = (float(i) + 0.5) / float(N);
        float r = sqrt(t) * radius;
        float a = a0 + float(i) * 2.39996323; // golden angle
        sum += texture(u_image0, uv + vec2(cos(a) * aspect, sin(a)) * r).rgb;
    }
    return sum / float(N);
}

void main() {
    int shp = int(u_shape + 0.5);
    vec2 cellPx = vec2(max(u_cell * u_resolution.y, 2.0));
    if (shp >= 7) cellPx.x *= 2.0 / 3.0; // glyph cells are 2:3; geometric shapes use SQUARE cells
    vec2 cell = floor(v_texCoord * u_resolution / cellPx);
    vec2 cuv = (cell + 0.5) * cellPx / u_resolution;
    vec3 col = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float tick = floor(u_time * u_speed * 8.0);
    float jitter = u_jitter * (hash2(cell + tick * 101.0, u_seed) - 0.5);
    float g = clamp(lum + jitter + u_brightness, 0.0, 1.0);
    if (u_invert > 0.5) g = 1.0 - g;

    // In-cell coordinate. At u_spacing == 0 this is byte-for-byte the original fract()
    // (no inset round-trip), so the default shape stays identical.
    vec2 inCell = fract(v_texCoord * u_resolution / cellPx);
    if (u_spacing > 0.0) inCell = (inCell - 0.5) / max(1.0 - u_spacing, 1e-3) + 0.5;

    float glyph;
    if (shp < 7) {
        // Geometric shapes render in the SQUARE cell above ⇒ circles are round, crosses/blocks
        // symmetric. (Glyph shapes keep the 2:3 atlas cell.)
        glyph = geoShape(shp, (inCell - 0.5) * 2.0, g, cell);
    } else {
        float gi = min(floor(g * u_glyphCount), u_glyphCount - 1.0);
        glyph = shp >= 14 ? sampleCustom(int(gi), inCell)        // Custom: user-typed glyphs
                          : sampleGlyph(int(gi), shp - 7, inCell);
    }

    vec3 ink = mix(vec3(1.0), col / max(lum, 1e-3), step(0.5, u_colored));
    vec3 fx = clamp(ink * glyph, 0.0, 1.0); // the ASCII layer, on black

    // Underlay: composite the ASCII layer over the SHARP, full-res source so the
    // original photo shows through and the glyphs light it up. Mode 0 = Replace is
    // the original black-background look (the default — nothing existing changes).
    int mode = int(u_underlay + 0.5);
    vec3 outc;
    if (mode == 0) {
        outc = fx;                                              // Replace (black bg)
    } else {
        vec3 base = sampleBase(v_texCoord);                     // per-pixel (optionally blurred), not cell-averaged
        if (mode == 1)      outc = 1.0 - (1.0 - base) * (1.0 - fx);  // Screen: only brightens
        else if (mode == 2) outc = base + fx;                       // Add: hotter glow
        else outc = mix(2.0 * base * fx,                            // Overlay: lighten + darken
                        1.0 - 2.0 * (1.0 - base) * (1.0 - fx),
                        step(0.5, base));
    }
    fragColor0 = vec4(clamp(outc, 0.0, 1.0), 1.0);
}
