import { describe, it, expect } from 'vitest'
import { validateHouseStyleEntry, upsertHouseStyle, type HouseStyleEntry } from '../../server/utils/houseStylesStore'

const valid: HouseStyleEntry = {
  id: 'rough-cut-revival',
  label: 'Rough Cut Revival',
  useCases: ['illustration', 'poster'],
  trigger: 'rough_cut_revival',
  tasteProfile: 'This aesthetic converges raw, high-contrast linocut techniques with a bold, muted color scheme.',
  replicateModel: 'finnyjules/jules-rough_cut_revival',
  weightsUrl: 'https://replicate.delivery/xezq/abc123/trained_model.tar',
  thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp', '/house-styles/rough-cut-revival/thumb-2.webp', '/house-styles/rough-cut-revival/thumb-3.webp', '/house-styles/rough-cut-revival/thumb-4.webp'],
  examplePrompts: ['a lighthouse on a cliff'],
}

describe('validateHouseStyleEntry', () => {
  it('accepts a complete entry', () => {
    expect(validateHouseStyleEntry(valid)).toEqual([])
  })
  it('blocks missing taste profile', () => {
    expect(validateHouseStyleEntry({ ...valid, tasteProfile: '  ' }).join(' ')).toMatch(/taste/i)
  })
  it('blocks versioned model refs and weights-shaped models', () => {
    expect(validateHouseStyleEntry({ ...valid, replicateModel: 'o/m:abc' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, replicateModel: 'https://x/y/trained_model.tar' }).length).toBeGreaterThan(0)
  })
  it('blocks bad weights url, bad id, empty tags, wrong thumb count', () => {
    expect(validateHouseStyleEntry({ ...valid, weightsUrl: 'https://elsewhere.com/x.tar' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, id: 'Bad Id!' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, useCases: [] }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, thumbnails: valid.thumbnails.slice(0, 2) }).length).toBeGreaterThan(0)
  })
})

describe('upsertHouseStyle', () => {
  it('appends new and replaces by replicateModel, sorted by label', () => {
    const other = { ...valid, id: 'azure-bloom', label: 'Azure Bloom', replicateModel: 'finnyjules/jules-azure' }
    let out = upsertHouseStyle([], valid)
    out = upsertHouseStyle(out, other)
    expect(out.map(e => e.id)).toEqual(['azure-bloom', 'rough-cut-revival'])
    const updated = { ...valid, label: 'Rough Cut Revival v2' }
    out = upsertHouseStyle(out, updated)
    expect(out.length).toBe(2)
    expect(out.find(e => e.replicateModel === valid.replicateModel)!.label).toBe('Rough Cut Revival v2')
  })
})
