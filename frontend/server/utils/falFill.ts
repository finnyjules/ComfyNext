/**
 * fal's flux-pro/v1/fill requires a non-empty `prompt` and 400s with
 * `{"detail":"Prompt is required"}` otherwise. The inpaint UI blanks a
 * pure-removal instruction ("remove the nose and the mouth") to '' so the model
 * reconstructs the masked region from its surroundings instead of re-drawing the
 * named thing. Replicate's flux-fill-dev tolerates that empty prompt; fal does
 * not. For the pro/fal path, substitute a neutral content-fill instruction that
 * asks for a seamless reconstruction rather than a new object.
 */
export const FAL_FILL_REMOVE_PROMPT =
  'clean, seamless background that matches the surrounding area'

export function falFillPrompt(prompt: string | undefined | null): string {
  const p = (prompt ?? '').trim()
  return p || FAL_FILL_REMOVE_PROMPT
}
