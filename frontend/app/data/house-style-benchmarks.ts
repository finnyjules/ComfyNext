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
  { id: 'portrait', seed: 101101, aspectRatio: '1:1', prompt: 'close-up portrait of a woman with long blonde hair, shoulders up, facing the camera, calm expression, plain neutral background, single subject only' },
  { id: 'scene', seed: 202202, aspectRatio: '1:1', prompt: 'a small corner cafe at dusk seen from across the street, two empty chairs on the sidewalk, warm light in the window, no people' },
  { id: 'object', seed: 303303, aspectRatio: '1:1', prompt: 'one single sneaker centered on a small pedestal, clean studio product shot, plain backdrop, nothing else in frame' },
  { id: 'type', seed: 404404, aspectRatio: '1:1', prompt: 'a flat poster design, the exact words "DOPE THINGS" in huge bold lettering filling the frame' },
]
