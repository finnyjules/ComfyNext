// frontend/app/lib/wardrobe/dress.ts
// Wardrobe "dress a character": pure instruction builder for the nano-banana-pro
// edit. Two input modes — a garment reference photo (virtual try-on) or a text
// outfit description — both preserving the person's identity and pose. Pure and
// deterministic; the surfaces (panel action, later a canvas node) call this and
// pass the returned prompt + image list to /api/inpaint/nano-gen.

/** Estimated cost of one dress generation (nano-banana-pro). Confirm vs billing. */
export const DRESS_COST_USD = 0.14

export type DressMode = 'garment' | 'text'

export interface DressOptions {
  mode: DressMode
  /** outfit description — required for text mode, optional refinement for garment mode. */
  outfit?: string
}

const PRESERVE = 'Preserve their face, hair, body, and pose exactly; replace only the clothing. Photorealistic, plain background.'

/**
 * Build the dressing instruction. In garment mode the caller sends two images
 * ([person, garment]); in text mode one ([person]). Returns '' when text mode has
 * no outfit — the caller should keep Generate disabled rather than send a no-op.
 */
export function buildDressPrompt(opts: DressOptions): string {
  const outfit = (opts.outfit ?? '').trim()
  if (opts.mode === 'garment') {
    const note = outfit ? ` Match this refinement: ${outfit}.` : ''
    return `Dress the person in the first image in the garment shown in the second image.${note} ${PRESERVE}`
  }
  if (!outfit) return ''
  return `Change the person's outfit to ${outfit}. ${PRESERVE}`
}
