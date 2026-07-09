/** Replicate input for trained-style sample generation (lora-gen endpoint). */
export function buildLoraGenInput(opts: {
  prompt: string
  aspectRatio?: string
  loraScale?: number
  guidanceScale?: number
  seed?: number
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio || '1:1',
    megapixels: '1',
    num_inference_steps: 22,
    guidance_scale: Number.isFinite(opts.guidanceScale) ? opts.guidanceScale : 3.5,
    num_outputs: 1,
    output_format: 'png',
    lora_scale: Number.isFinite(opts.loraScale) ? opts.loraScale : 1,
  }
  if (Number.isFinite(opts.seed)) input.seed = opts.seed
  return input
}
