#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;

uniform float u_segments;
uniform float u_rotation;
uniform float u_zoom;

void main() {
    vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 p = (v_texCoord - 0.5) * asp;
    float r = length(p);
    float a = atan(p.y, p.x) + radians(u_rotation);
    float seg = 6.28318 / max(u_segments, 2.0);
    a = mod(a, seg);
    a = abs(a - seg * 0.5);                 // mirror within the wedge
    vec2 uv = vec2(cos(a), sin(a)) * r * u_zoom / asp + 0.5;
    uv = abs(fract(uv * 0.5) * 2.0 - 1.0);  // triangle-wave mirror tiling (no edge clamp seam)
    fragColor0 = vec4(texture(u_image0, uv).rgb, 1.0);
}
