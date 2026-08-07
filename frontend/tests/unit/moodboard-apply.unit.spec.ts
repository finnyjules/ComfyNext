import { describe, it, expect } from 'vitest'
import {
  applyMoodboardToGenerateNode,
  clearMoodboardFromGenerateNode,
  revertMoodboardSwitch,
  MOODBOARD_DEFAULT_MODEL,
  MOODBOARD_MAX_REFS,
} from '~/lib/graph/moodboardApply'
import { moodboardStyleBlock } from '~/lib/taste/styleBlock'
import { IMAGE_MODELS_BY_ID } from '~/data/image-models'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

/** The pure apply helper (moodboards Plan B, Tasks B2+B3) — the same writes
 *  the chip picker performs now and the B4 wire will perform later. B3 adds
 *  the refs payload (tag-gated), the legible auto-switch and its revert. */

const ENTRY: MoodboardEntry = {
  id: 'dusty-pastels',
  name: 'Dusty Pastels',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  folder: 'moodboard_1754000000000',
  reading: {
    summary: 'Sun-bleached pastel still lifes',
    palette: [
      { name: 'Chalk Rose', hex: '#e8c4c4' },
      { name: 'Sage Mist', hex: '#b6c9b2' },
    ],
    avoids: ['neon', 'hard shadows'],
  },
}

const FILES = ['00_a.png', '01_b.jpg', '02_c.webp', '03_d.png']

// Tag fixtures come from the REAL catalog so the gate can't drift from it.
const NANO_TAGS = [...IMAGE_MODELS_BY_ID['nano-banana-pro']!.tags] as string[]
const FLUX_TAGS = [...IMAGE_MODELS_BY_ID['flux-schnell']!.tags] as string[]

function apply(node: any, opts: { files?: string[]; modelId?: string; modelTags?: string[] } = {}) {
  return applyMoodboardToGenerateNode(
    node, ENTRY,
    opts.files ?? FILES,
    opts.modelId ?? 'nano-banana-pro',
    opts.modelTags ?? NANO_TAGS,
  )
}

describe('applyMoodboardToGenerateNode — block + identity (B2)', () => {
  it('writes the composed style block into properties.aesthetic and the id into sailor_moodboard', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = apply(node)

    expect(node.properties.aesthetic).toBe(moodboardStyleBlock(ENTRY.reading))
    expect(node.properties.sailor_moodboard).toBe('dusty-pastels')
    // The block really is the spec composition, not empty.
    expect(node.properties.aesthetic).toContain('In the style of: Sun-bleached pastel still lifes.')
    expect(node.properties.aesthetic).toContain('Chalk Rose #e8c4c4')
    expect(node.properties.aesthetic).toContain('Avoid: neon, hard shadows.')
    // Returned writes mirror what landed on the node.
    expect(writes.aesthetic).toBe(node.properties.aesthetic)
    expect(writes.sailor_moodboard).toBe('dusty-pastels')
  })

  it('creates the properties bag when the node has none', () => {
    const node: { properties?: Record<string, any> } = {}
    apply(node)
    expect(node.properties?.sailor_moodboard).toBe('dusty-pastels')
  })

  it('replaces a previously applied board outright', () => {
    const node = { properties: { aesthetic: 'old block', sailor_moodboard: 'old-board' } }
    apply(node)
    expect(node.properties.sailor_moodboard).toBe('dusty-pastels')
    expect(node.properties.aesthetic).toBe(moodboardStyleBlock(ENTRY.reading))
  })
})

describe('applyMoodboardToGenerateNode — refs payload, gated by the multi-image tag (B3)', () => {
  it('writes style_refs JSON {folder, files[≤3]} on a ref-capable model', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = apply(node)
    expect(writes.style_refs).toBe(node.properties.style_refs)
    const parsed = JSON.parse(node.properties.style_refs)
    expect(parsed).toEqual({
      folder: ENTRY.folder,
      files: FILES.slice(0, MOODBOARD_MAX_REFS), // first 3 of 4 — the cap
    })
    // No switch happened — nano already takes refs.
    expect(writes.model).toBeNull()
    expect(writes.switchedFrom).toBeNull()
    expect('sailor_moodboard_switched' in node.properties).toBe(false)
  })

  it('writes an EMPTY style_refs when the model cannot take refs (manual choice standing)', () => {
    // Board applied, no marker ⇒ the flux model is the user's own pick.
    const node = { properties: { sailor_moodboard: 'prior-board' } as Record<string, any> }
    const writes = apply(node, { modelId: 'flux-dev', modelTags: FLUX_TAGS })
    expect(writes.style_refs).toBe('')
    expect(node.properties.style_refs).toBe('')
  })

  it('writes an EMPTY style_refs when the board has no files, even on a ref model', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = apply(node, { files: [] })
    expect(writes.style_refs).toBe('')
  })
})

describe('applyMoodboardToGenerateNode — legible auto-switch (B3)', () => {
  it('switches a non-ref model to the moodboard default and writes the marker', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = apply(node, { modelId: 'flux-schnell', modelTags: FLUX_TAGS })

    expect(MOODBOARD_DEFAULT_MODEL).toBe('nano-banana-pro')
    expect(writes.model).toBe(MOODBOARD_DEFAULT_MODEL)
    expect(writes.switchedFrom).toBe('flux-schnell')
    expect(node.properties.sailor_moodboard_switched).toBe('flux-schnell')
    // Refs ride on the SWITCHED-TO model's capability.
    expect(JSON.parse(node.properties.style_refs).folder).toBe(ENTRY.folder)
  })

  it('manual choice wins: an applied board with NO marker never re-switches', () => {
    // State after the user manually picked flux-dev while a board was applied
    // (ModelGalleryModal cleared the marker on that pick).
    const node = { properties: { sailor_moodboard: 'dusty-pastels', aesthetic: 'block' } as Record<string, any> }
    const writes = apply(node, { modelId: 'flux-dev', modelTags: FLUX_TAGS })

    expect(writes.model).toBeNull()
    expect(writes.switchedFrom).toBeNull()
    expect('sailor_moodboard_switched' in node.properties).toBe(false)
    expect(node.properties.style_refs).toBe('') // flux takes no refs
  })

  it('re-switching over an existing marker keeps the ORIGINAL previous model', () => {
    // Degenerate state: marker present but model non-ref again. Revert must
    // still land on the user's true pre-switch model.
    const node = {
      properties: {
        sailor_moodboard: 'dusty-pastels',
        sailor_moodboard_switched: 'flux-schnell',
      } as Record<string, any>,
    }
    const writes = apply(node, { modelId: 'flux-dev', modelTags: FLUX_TAGS })
    expect(writes.model).toBe(MOODBOARD_DEFAULT_MODEL)
    expect(node.properties.sailor_moodboard_switched).toBe('flux-schnell')
  })
})

describe('revertMoodboardSwitch (B3)', () => {
  it('returns the previous model and clears marker + refs, keeping the board applied', () => {
    const node = {
      properties: {
        aesthetic: 'block',
        sailor_moodboard: 'dusty-pastels',
        style_refs: '{"folder":"moodboard_1","files":["a.png"]}',
        sailor_moodboard_switched: 'flux-schnell',
      } as Record<string, any>,
    }
    expect(revertMoodboardSwitch(node)).toBe('flux-schnell')
    expect('sailor_moodboard_switched' in node.properties).toBe(false)
    expect('style_refs' in node.properties).toBe(false)
    // The board itself stays — revert is about the MODEL.
    expect(node.properties.sailor_moodboard).toBe('dusty-pastels')
    expect(node.properties.aesthetic).toBe('block')
  })

  it('is a no-op without a marker', () => {
    const node = { properties: { sailor_moodboard: 'dusty-pastels', style_refs: 'x' } }
    expect(revertMoodboardSwitch(node)).toBeNull()
    expect(node.properties.style_refs).toBe('x')
    expect(revertMoodboardSwitch({})).toBeNull()
  })
})

describe('clearMoodboardFromGenerateNode', () => {
  it('removes the aesthetic, identity, refs payload and switch marker', () => {
    const node = {
      properties: {
        aesthetic: 'block',
        sailor_moodboard: 'dusty-pastels',
        style_refs: '{"folder":"moodboard_1","files":["a.png"]}',
        sailor_moodboard_switched: 'flux-schnell',
        other: 1,
      },
    }
    clearMoodboardFromGenerateNode(node)
    expect('aesthetic' in node.properties).toBe(false)
    expect('sailor_moodboard' in node.properties).toBe(false)
    expect('style_refs' in node.properties).toBe(false)
    expect('sailor_moodboard_switched' in node.properties).toBe(false)
    // Unrelated properties survive.
    expect(node.properties.other).toBe(1)
  })

  it('tolerates a node with no properties bag', () => {
    expect(() => clearMoodboardFromGenerateNode({})).not.toThrow()
  })
})
