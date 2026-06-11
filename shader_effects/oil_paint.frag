#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uniform float u_radius;

// Kuwahara filter: of the four corner quadrants around each pixel, output the
// mean colour of whichever has the lowest luminance variance — flattens detail
// into painterly regions while keeping edges crisp.
void main() {
    vec2 texel = 1.0 / u_resolution;
    int R = int(clamp(u_radius * u_resolution.y, 1.0, 6.0));
    const ivec2 dirs[4] = ivec2[4](ivec2(-1, -1), ivec2(1, -1), ivec2(-1, 1), ivec2(1, 1));

    vec3 bestMean = texture(u_image0, v_texCoord).rgb;
    float bestVar = 1e9;
    for (int q = 0; q < 4; q++) {
        vec3 sum = vec3(0.0);
        float sum2 = 0.0;
        float n = 0.0;
        for (int i = 0; i <= 6; i++) {
            if (i > R) break;
            for (int j = 0; j <= 6; j++) {
                if (j > R) break;
                vec2 off = vec2(float(i * dirs[q].x), float(j * dirs[q].y)) * texel;
                vec3 c = texture(u_image0, clamp(v_texCoord + off, 0.0, 1.0)).rgb;
                float l = dot(c, vec3(0.299, 0.587, 0.114));
                sum += c;
                sum2 += l * l;
                n += 1.0;
            }
        }
        vec3 m = sum / n;
        float lm = dot(m, vec3(0.299, 0.587, 0.114));
        float v = sum2 / n - lm * lm;
        if (v < bestVar) { bestVar = v; bestMean = m; }
    }
    fragColor0 = vec4(bestMean, 1.0);
}
