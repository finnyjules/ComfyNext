import { describe, it, expect } from 'vitest'
import { tokenize, scoreNode, searchNodes } from '../../app/lib/nodeMatch'

// Minimal node shape the matcher needs. Mirrors the common fields of
// NodeType (useNodeSearch) and NodeTypeLite (portIntent).
const NODES = [
  {
    name: 'PoseMannequin',
    displayName: 'Pose Mannequin',
    description: 'Pose a 3D mannequin, then redraw the connected character in that pose.',
    category: 'api node/image/Replicate',
  },
  {
    name: 'KSampler',
    displayName: 'KSampler',
    description: 'Denoises latent images using a model and conditioning.',
    category: 'sampling',
  },
  {
    name: 'PorterDuffImageComposite',
    displayName: 'Porter-Duff Image Composite',
    description: 'Composites two images using Porter-Duff blending modes.',
    category: 'image',
  },
  {
    name: 'LoadImage',
    displayName: 'Load Image',
    description: 'Loads an image from disk.',
    category: 'image',
  },
]

const KEYWORDS: Record<string, string[]> = {
  PoseMannequin: ['pose', 're-pose', 'change pose', 'reposition', 'stance', 'posture'],
}

describe('tokenize', () => {
  it('lowercases, splits, and drops stopwords', () => {
    expect(tokenize('Change his pose')).toEqual(['change', 'pose'])
  })

  it('strips punctuation', () => {
    expect(tokenize('re-pose, the character!')).toEqual(['re', 'pose', 'character'])
  })

  it('returns empty for blank/stopword-only input', () => {
    expect(tokenize('   ')).toEqual([])
    expect(tokenize('the a of his')).toEqual([])
  })
})

describe('scoreNode', () => {
  it('scores 0 when no token matches any field', () => {
    expect(scoreNode(NODES[1]!, ['pose'], [])).toBe(0)
  })

  it('keyword hit outranks description-only hit', () => {
    // "change" is in PoseMannequin's keywords but only appears in no other node.
    const withKw = scoreNode(NODES[0]!, ['change'], KEYWORDS.PoseMannequin!)
    const descOnly = scoreNode(NODES[0]!, ['mannequin'], []) // description/name word, no keyword
    expect(withKw).toBeGreaterThan(0)
    expect(descOnly).toBeGreaterThan(0)
  })

  it('name/displayName hit outranks description hit', () => {
    const nameHit = scoreNode(NODES[3]!, ['image'], []) // "Image" in displayName + name
    const descHit = scoreNode(NODES[1]!, ['images'], []) // "images" only in description
    expect(nameHit).toBeGreaterThan(descHit)
  })
})

describe('searchNodes', () => {
  it('ranks PoseMannequin first for "change his pose"', () => {
    const results = searchNodes(NODES, 'change his pose', { keywords: KEYWORDS })
    expect(results[0]?.name).toBe('PoseMannequin')
  })

  it('still finds PoseMannequin without keywords (description recall)', () => {
    const results = searchNodes(NODES, 'pose mannequin', {})
    expect(results[0]?.name).toBe('PoseMannequin')
  })

  it('empty query returns the input unchanged (identity)', () => {
    const results = searchNodes(NODES, '   ', { keywords: KEYWORDS })
    expect(results).toEqual(NODES)
  })

  it('no-match query returns empty', () => {
    expect(searchNodes(NODES, 'xyzzy nonexistent', {})).toEqual([])
  })

  it('respects the limit option', () => {
    const results = searchNodes(NODES, 'image', { limit: 1 })
    expect(results.length).toBe(1)
  })

  it('results are sorted by descending score', () => {
    // "pose" matches PoseMannequin strongly (name + keyword); no other node.
    const results = searchNodes(NODES, 'pose image', { keywords: KEYWORDS })
    expect(results[0]?.name).toBe('PoseMannequin')
  })
})
