import { describe, it, expect } from 'vitest'
import { isSafeLoraFilename, loraBaseName, buildDuplicateSidecar } from '../../server/utils/loraSidecars'

const source = {
  name: 'Azure_Bloom',
  base_model: 'flux-dev',
  provider: 'replicate',
  trigger: 'azure_bloom',
  replicate_prediction_id: 'vbrs2g8e95rmw0cyj4e8qt06d0',
  replicate_model: 'finnyjules/jules-azure_bloom:161403ca8d26',
  replicate_url: 'https://replicate.delivery/xezq/abc/trained_model.tar',
  aesthetic: 'Warm botanicals against flat azure, fauvist brushwork, high contrast.',
  trained_on: '2026-06-04T05:42:25.677Z',
  kind: 'style',
}

describe('isSafeLoraFilename', () => {
  it('accepts a bare .safetensors name', () => {
    expect(isSafeLoraFilename('Azure_Bloom.safetensors')).toBe(true)
  })
  it('rejects traversal, separators and non-safetensors', () => {
    expect(isSafeLoraFilename('../../etc/passwd.safetensors')).toBe(false)
    expect(isSafeLoraFilename('sub/Azure.safetensors')).toBe(false)
    expect(isSafeLoraFilename('sub\\Azure.safetensors')).toBe(false)
    expect(isSafeLoraFilename('Azure_Bloom.json')).toBe(false)
    expect(isSafeLoraFilename('')).toBe(false)
  })
})

describe('loraBaseName', () => {
  it('keeps the trainer\'s underscore convention and strips unsafe characters', () => {
    expect(loraBaseName('Azure Bloom Noir')).toBe('Azure_Bloom_Noir')
    expect(loraBaseName('  Azure/Bloom: noir!  ')).toBe('Azure_Bloom_noir')
  })
  it('neutralizes traversal attempts', () => {
    for (const attempt of ['../../escape', '..', './../x', 'a/../../b']) {
      const base = loraBaseName(attempt)
      expect(base).not.toMatch(/[/\\]/)
      expect(base).not.toContain('..')
    }
  })
  it('returns empty for a name with nothing usable, so callers can 400', () => {
    expect(loraBaseName('   ')).toBe('')
    expect(loraBaseName('///')).toBe('')
  })
})

describe('buildDuplicateSidecar', () => {
  const dup = buildDuplicateSidecar(source, 'Azure Bloom Noir')

  it('carries what makes the copy run the same weights', () => {
    expect(dup.replicate_model).toBe(source.replicate_model)
    expect(dup.replicate_url).toBe(source.replicate_url)
    expect(dup.trigger).toBe(source.trigger)
    expect(dup.base_model).toBe(source.base_model)
    expect(dup.provider).toBe(source.provider)
    expect(dup.kind).toBe(source.kind)
  })

  it('carries trained_on so the copy matches the same dataset folder', () => {
    expect(dup.trained_on).toBe(source.trained_on)
  })

  it('carries the aesthetic as a starting point and takes the new name', () => {
    expect(dup.aesthetic).toBe(source.aesthetic)
    expect(dup.name).toBe('Azure Bloom Noir')
  })

  it('drops the original training run\'s prediction id', () => {
    expect(dup.replicate_prediction_id).toBeUndefined()
  })

  it('records provenance', () => {
    expect(dup.duplicate_of).toBe('Azure_Bloom')
  })

  it('does not mutate the source sidecar', () => {
    expect(source.name).toBe('Azure_Bloom')
    expect(source.replicate_prediction_id).toBe('vbrs2g8e95rmw0cyj4e8qt06d0')
  })

  it('reads the legacy taste_profile key when aesthetic is absent', () => {
    const legacy = { ...source, aesthetic: undefined, taste_profile: 'Legacy profile text here.' }
    expect(buildDuplicateSidecar(legacy, 'X').aesthetic).toBe('Legacy profile text here.')
  })

  it('omits an absent aesthetic rather than writing an empty string', () => {
    const bare = { replicate_model: 'o/m', name: 'Bare' }
    expect('aesthetic' in buildDuplicateSidecar(bare, 'Copy')).toBe(false)
  })
})
