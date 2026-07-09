/**
 * Fixed benchmark subjects + seeds for house-style thumbnails. Every style
 * bakes the SAME 4 shots so the hub grid compares apples to apples.
 * FROZEN once styles ship — a re-bake must reproduce the same grid.
 * Prompts are deliberately style-free: /api/inpaint/lora-gen injects the
 * style's trigger + aesthetic server-side (buildLoraPrompt).
 */
export interface BenchmarkShot {
  id: 'portrait' | 'scene' | 'object' | 'type'
  prompt: string
  seed: number
  aspectRatio: '1:1'
}

export const BENCHMARK_SHOTS: BenchmarkShot[] = [
  { id: 'portrait', seed: 101101, aspectRatio: '1:1', prompt: 'portrait of a woman with short dark hair, shoulders up, calm expression, plain background' },
  { id: 'scene', seed: 202202, aspectRatio: '1:1', prompt: 'a quiet street corner cafe at dusk, two empty chairs outside, warm light in the window' },
  { id: 'object', seed: 303303, aspectRatio: '1:1', prompt: 'a single sneaker on a small pedestal, clean studio product shot' },
  { id: 'type', seed: 404404, aspectRatio: '1:1', prompt: 'a poster dominated by the large word "NOVA" in bold lettering' },
]
