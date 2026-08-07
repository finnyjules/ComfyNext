import { describe, it, expect } from 'vitest'
import {
  applyMoodboardToGenerateNode,
  clearMoodboardFromGenerateNode,
} from '~/lib/graph/moodboardApply'
import { moodboardStyleBlock } from '~/lib/taste/styleBlock'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

/** Basics for the pure apply helper (moodboards Plan B, Task B2) — the same
 *  writes the chip picker performs now and the B4 wire will perform later. */

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

describe('applyMoodboardToGenerateNode', () => {
  it('writes the composed style block into properties.aesthetic and the id into sailor_moodboard', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = applyMoodboardToGenerateNode(node, ENTRY)

    expect(node.properties.aesthetic).toBe(moodboardStyleBlock(ENTRY.reading))
    expect(node.properties.sailor_moodboard).toBe('dusty-pastels')
    // The block really is the spec composition, not empty.
    expect(node.properties.aesthetic).toContain('In the style of: Sun-bleached pastel still lifes.')
    expect(node.properties.aesthetic).toContain('Chalk Rose #e8c4c4')
    expect(node.properties.aesthetic).toContain('Avoid: neon, hard shadows.')
    // Returned writes mirror what landed on the node.
    expect(writes).toEqual({
      aesthetic: node.properties.aesthetic,
      sailor_moodboard: 'dusty-pastels',
    })
  })

  it('creates the properties bag when the node has none', () => {
    const node: { properties?: Record<string, any> } = {}
    applyMoodboardToGenerateNode(node, ENTRY)
    expect(node.properties?.sailor_moodboard).toBe('dusty-pastels')
  })

  it('replaces a previously applied board outright', () => {
    const node = { properties: { aesthetic: 'old block', sailor_moodboard: 'old-board' } }
    applyMoodboardToGenerateNode(node, ENTRY)
    expect(node.properties.sailor_moodboard).toBe('dusty-pastels')
    expect(node.properties.aesthetic).toBe(moodboardStyleBlock(ENTRY.reading))
  })
})

describe('clearMoodboardFromGenerateNode', () => {
  it('removes both the aesthetic and the identity key', () => {
    const node = { properties: { aesthetic: 'block', sailor_moodboard: 'dusty-pastels', other: 1 } }
    clearMoodboardFromGenerateNode(node)
    expect('aesthetic' in node.properties).toBe(false)
    expect('sailor_moodboard' in node.properties).toBe(false)
    // Unrelated properties survive.
    expect(node.properties.other).toBe(1)
  })

  it('tolerates a node with no properties bag', () => {
    expect(() => clearMoodboardFromGenerateNode({})).not.toThrow()
  })
})
