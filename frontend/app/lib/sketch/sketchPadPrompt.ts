/**
 * Widget/property overrides for the TRANSIENT sketch-pad generator node. The pad
 * is invisible plumbing — the user enters via the prompt bar (the visible Sketch
 * node is retired). `sketchPad:true` (not `sketch:true`) marks it so the executed
 * handler routes its batch to the pad materializer and full runs skip it.
 * (spec §2, §6)
 */
export function sketchPadPromptOverrides(prompt: string, seed: number): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides: Record<string, unknown>
} {
  return {
    widgetOverrides: {
      model: 'flux-schnell',
      prompt,
      seed,
      model_options: JSON.stringify({ megapixels: '0.25', num_outputs: 4, output_format: 'webp' }),
    },
    propertyOverrides: { sketchPad: true },
  }
}
