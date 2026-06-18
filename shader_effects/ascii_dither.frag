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

// Geometric coverage: 1 inside the shape, 0 outside. q is centered in [-1,1], t = luminance.
float geoShape(int shp, vec2 q, float t, vec2 cell) {
    if (shp == 0) shp = 1 + int(floor(hash2(cell, u_seed + 7.0) * 6.0)); // Mixed: pick 1..6 per cell
    float r = length(q);
    if (shp == 1) return step(max(abs(q.x), abs(q.y)), t);          // Blocks
    if (shp == 2) return step(r, t);                                // Circles
    if (shp == 3) return step(abs(q.y), t);                         // Lines
    if (shp == 4) return step(abs(q.x - q.y) * 0.70710678, t);      // Diagonal
    if (shp == 5) return step(min(abs(q.x), abs(q.y)), t * 0.5);    // Cross
    return step((abs(q.x) + abs(q.y)) * 0.70710678, t);            // Diamond (6)
}

void main() {
    vec2 cellPx = vec2(max(u_cell * u_resolution.y, 2.0));
    cellPx.x *= 2.0 / 3.0; // glyph cells are 2:3
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

    int shp = int(u_shape + 0.5);
    float glyph;
    if (shp < 7) {
        // The cell is 2:3 (to fit the glyph atlas). Aspect-correct so the GEOMETRIC shapes
        // (circles/blocks/diamonds/…) stay round/square in screen space instead of stretching
        // into ovals/rectangles. Glyph shapes (shp >= 7) keep the raw 2:3 cell unchanged.
        vec2 q = (inCell - 0.5) * 2.0;
        q.x *= cellPx.x / cellPx.y;
        glyph = geoShape(shp, q, g, cell);
    } else {
        float gi = min(floor(g * u_glyphCount), u_glyphCount - 1.0);
        int row = shp - 7;
        const int CW = 32, CH = 48, TOTAL_ROWS = 7;
        // texelFetch uses integer GL texel coords. The atlas is uploaded via arr[::-1]
        // (Y-flipped for GL convention), so numpy row R maps to GL texel Y =
        // (TOTAL_ROWS - 1 - R) * CH + in_row_pixel. inCell.y=0 is GL-bottom, which
        // equals the highest numpy pixel in the row group (also flipped), so:
        //   ty = (TOTAL_ROWS - 1 - row) * CH + int(inCell.y * CH)
        // This is independent of atlas height and exact-NEAREST for any row.
        if (inCell.x < 0.0 || inCell.x >= 1.0 || inCell.y < 0.0 || inCell.y >= 1.0) {
            glyph = 0.0;
        } else {
            int tx = int(gi) * CW + int(inCell.x * float(CW));
            int ty = (TOTAL_ROWS - 1 - row) * CH + int(inCell.y * float(CH));
            glyph = texelFetch(u_glyphs, ivec2(tx, ty), 0).r;
        }
    }

    vec3 ink = mix(vec3(1.0), col / max(lum, 1e-3), step(0.5, u_colored));
    fragColor0 = vec4(clamp(ink * glyph, 0.0, 1.0), 1.0);
}
