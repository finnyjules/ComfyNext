import { describe, it, expect } from 'vitest'
import { validateHouseStyleEntry, upsertHouseStyle, findIdCollision, decodeWebpThumbnail, type HouseStyleEntry } from '../../server/utils/houseStylesStore'

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
  it('appends new and replaces by id, sorted by label', () => {
    const other = { ...valid, id: 'azure-bloom', label: 'Azure Bloom', replicateModel: 'finnyjules/jules-azure' }
    let out = upsertHouseStyle([], valid)
    out = upsertHouseStyle(out, other)
    expect(out.map(e => e.id)).toEqual(['azure-bloom', 'rough-cut-revival'])
    const updated = { ...valid, label: 'Rough Cut Revival v2' }
    out = upsertHouseStyle(out, updated)
    expect(out.length).toBe(2)
    expect(out.find(e => e.id === valid.id)!.label).toBe('Rough Cut Revival v2')
  })

  // Two taste profiles over one training run: same trained model, different ids.
  // Keyed on replicateModel the second publish would silently erase the first.
  it('keeps two entries that share a replicateModel but differ by id', () => {
    const variant = { ...valid, id: 'rough-cut-noir', label: 'Rough Cut Noir', tasteProfile: `${valid.tasteProfile} Darker.` }
    let out = upsertHouseStyle([], valid)
    out = upsertHouseStyle(out, variant)
    expect(out.map(e => e.id)).toEqual(['rough-cut-noir', 'rough-cut-revival'])
    expect(out.every(e => e.replicateModel === valid.replicateModel)).toBe(true)
  })
})

describe('decodeWebpThumbnail', () => {
  // Minimal hand-made valid webp container: 'RIFF' + 4 arbitrary size bytes + 'WEBP' + a few payload bytes.
  const validBuf = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0x00, 0x01, 0x02, 0x03]),
    Buffer.from('WEBP', 'ascii'),
    Buffer.from([0xaa, 0xbb, 0xcc]),
  ])
  const validDataUrl = `data:image/webp;base64,${validBuf.toString('base64')}`

  it('decodes a valid webp data URL to a Buffer', () => {
    const out = decodeWebpThumbnail(validDataUrl)
    expect(out).toBeInstanceOf(Buffer)
    expect(out).toEqual(validBuf)
  })

  it('rejects a bad data-url prefix', () => {
    expect(decodeWebpThumbnail(`data:image/png;base64,${validBuf.toString('base64')}`)).toBeNull()
  })

  it('rejects a value that is not a base64 webp data URL at all', () => {
    expect(decodeWebpThumbnail('not-a-data-url')).toBeNull()
    expect(decodeWebpThumbnail('')).toBeNull()
  })

  it('rejects RIFF-shaped data missing the WEBP marker', () => {
    const badBuf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
      Buffer.from('JPEG', 'ascii'),
      Buffer.from([0xaa, 0xbb, 0xcc]),
    ])
    expect(decodeWebpThumbnail(`data:image/webp;base64,${badBuf.toString('base64')}`)).toBeNull()
  })
})

describe('findIdCollision', () => {
  it('flags same id with a different replicateModel', () => {
    const conflicting = { ...valid, replicateModel: 'finnyjules/jules-different-model' }
    expect(findIdCollision([valid], conflicting)).toEqual(valid)
  })
  it('allows same id with the same replicateModel (republish)', () => {
    const republish = { ...valid, label: 'Rough Cut Revival v2' }
    expect(findIdCollision([valid], republish)).toBeUndefined()
  })
  it('ignores unrelated entries', () => {
    const other = { ...valid, id: 'azure-bloom', label: 'Azure Bloom', replicateModel: 'finnyjules/jules-azure' }
    expect(findIdCollision([other], valid)).toBeUndefined()
  })
})
