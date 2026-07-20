// Shared layer-blend vocabulary for the studios (gradient, shader, later pattern).
// Both the gradient fragment shader and the shader-studio composite pass import
// BLEND_LAYERS_GLSL so the two can never blend differently.

export type BlendKind = 'normal' | 'lighten' | 'screen' | 'add' | 'multiply' | 'darken' | 'overlay'

export const BLEND_MODES: BlendKind[] = ['normal', 'lighten', 'screen', 'add', 'multiply', 'darken', 'overlay']

export const BLEND_IDX: Record<BlendKind, number> = {
  normal: 0, lighten: 1, screen: 2, add: 3, multiply: 4, darken: 5, overlay: 6,
}

/** GLSL ES 3.00 snippet defining `blendLayers`. Inject into a fragment source. */
export const BLEND_LAYERS_GLSL = `
vec3 blendLayers(vec3 base, vec3 src, float mode) {
  int m = int(mode + 0.5);
  if (m == 1) return max(base, src);
  if (m == 2) return 1.0 - (1.0 - base) * (1.0 - src);
  if (m == 3) return min(base + src, vec3(1.0));
  if (m == 4) return base * src;
  if (m == 5) return min(base, src);
  if (m == 6) return mix(2.0 * base * src, 1.0 - 2.0 * (1.0 - base) * (1.0 - src), step(0.5, base));
  return src; // normal
}
`
