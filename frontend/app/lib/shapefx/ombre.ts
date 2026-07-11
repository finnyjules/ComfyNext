import * as THREE from 'three'

/**
 * The ombré material: renders the harmony ramp with a per-PIXEL grainy dither (solid → speckle
 * → solid), like this app's Ombré fill. Grain lives at fragment resolution — vertex colors can't
 * do it (they interpolate smoothly across a facet) — so this is the studio's one ShaderMaterial.
 * Still unlit/flat: the fragment just picks a ramp color, no lighting.
 *
 * Each vertex carries `aT` = its position along the ramp (0–1, from vertexRampT). The fragment
 * finds where t falls between two ramp stops and, per pixel, snaps to the LOWER or UPPER stop
 * with a hashed probability equal to the fractional position — so the two tones mix as scattered
 * dots whose density shifts across the fade.
 */
const VERT = /* glsl */`
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */`
precision highp float;
varying float vT;
uniform vec3 uRamp[8];
uniform int uCount;
uniform float uCell;   // grain cell size in px (bigger = chunkier speckle)
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
void main() {
  float t = clamp(vT, 0.0, 1.0);
  float f = t * float(uCount - 1);
  int i0 = int(floor(f));
  float frac = f - floor(f);
  float h = hash(floor(gl_FragCoord.xy / max(1.0, uCell)));
  int idx = i0 + (h < frac ? 1 : 0);
  idx = idx < uCount ? idx : uCount - 1;
  vec3 col = uRamp[0];
  for (int k = 0; k < 8; k++) { if (k == idx) col = uRamp[k]; }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

/** Build the ombré ShaderMaterial from the ramp hex colors. `cell` = grain size in px. */
export function makeOmbreMaterial(rampHex: string[], cell = 2): THREE.ShaderMaterial {
  const ramp: THREE.Vector3[] = []
  for (let i = 0; i < 8; i++) {
    // THREE.Color decodes the sRGB hex into the linear working space; the shader's
    // colorspace_fragment converts back to the renderer's output space on write.
    const c = new THREE.Color(rampHex[Math.min(i, rampHex.length - 1)] ?? '#000000')
    ramp.push(new THREE.Vector3(c.r, c.g, c.b))
  }
  return new THREE.ShaderMaterial({
    uniforms: {
      uRamp: { value: ramp },
      uCount: { value: Math.max(2, Math.min(8, rampHex.length)) },
      uCell: { value: cell },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
}
