/**
 * Prompt builders for the interactive edit actions (Recolor in the
 * InpaintModal, Harmonize in the Compositor). The graph-node siblings build
 * their prompts Python-side in comfy_extras/_edit_action_prompts.py — keep the
 * two in the same spirit if you tune one.
 */

/** Masked recolor via FLUX Fill: the SAM mask already isolates the object, so
 *  the prompt describes the SAME object in a new colour — never a replacement. */
export function recolorPrompt(colorLabel: string): string {
  return (
    `the exact same object recolored to ${colorLabel.trim()}, identical shape ` +
    'and material, keeping its texture, shading, highlights, reflections and ' +
    'the scene\'s lighting unchanged — only the base colour is different'
  )
}

/** Two-image nano-banana-2 edit: [scene crop, layer cutout] → the cutout
 *  relit/graded to sit in the scene. Order is load-bearing. */
export const HARMONIZE_PROMPT =
  'The first image is a scene. The second image is an object that will be ' +
  'composited into that scene. Relight and color-grade the object in the ' +
  'second image so it is physically lit by the first image\'s scene: match ' +
  'the lighting direction, colour temperature, contrast and falloff. Keep the ' +
  'object\'s identity, shape, proportions, pose and framing EXACTLY as in the ' +
  'second image — same silhouette, same camera, no repositioning, no added ' +
  'background. Return the object alone on a plain uniform background. ' +
  'Output only the edited object image.'
