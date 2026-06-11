#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uniform float u_scale;
uniform float u_levels;
uniform float u_colored;

const int B4[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

float bayer(ivec2 c) {
    int x = c.x - (c.x / 4) * 4;
    int y = c.y - (c.y / 4) * 4;
    x = x < 0 ? x + 4 : x;
    y = y < 0 ? y + 4 : y;
    return (float(B4[y * 4 + x]) + 0.5) / 16.0;
}

void main() {
    float cell = max(u_scale * u_resolution.y, 1.0);
    ivec2 dc = ivec2(floor(v_texCoord * u_resolution / cell));
    vec2 cuv = (vec2(dc) + 0.5) * cell / u_resolution;
    vec3 src = texture(u_image0, clamp(cuv, 0.0, 1.0)).rgb;

    float L = max(u_levels, 2.0) - 1.0;
    float th = bayer(dc) - 0.5;
    if (u_colored > 0.5) {
        vec3 col = floor(src * L + th + 0.5) / L;
        fragColor0 = vec4(clamp(col, 0.0, 1.0), 1.0);
    } else {
        float lum = dot(src, vec3(0.299, 0.587, 0.114));
        float q = floor(lum * L + th + 0.5) / L;
        fragColor0 = vec4(vec3(clamp(q, 0.0, 1.0)), 1.0);
    }
}
