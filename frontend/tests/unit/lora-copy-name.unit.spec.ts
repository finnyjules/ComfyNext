import { describe, it, expect } from 'vitest'
import { nextCopyName } from '~/lib/lora/copyName'

describe('nextCopyName', () => {
  it('appends "copy" the first time', () => {
    expect(nextCopyName('Azure Bloom', ['Azure Bloom'])).toBe('Azure Bloom copy')
  })

  it('numbers subsequent copies instead of colliding', () => {
    const names = ['Azure Bloom', 'Azure Bloom copy']
    expect(nextCopyName('Azure Bloom', names)).toBe('Azure Bloom copy 2')
    expect(nextCopyName('Azure Bloom', [...names, 'Azure Bloom copy 2'])).toBe('Azure Bloom copy 3')
  })

  it('copies a copy without stacking suffixes', () => {
    expect(nextCopyName('Azure Bloom copy', ['Azure Bloom', 'Azure Bloom copy']))
      .toBe('Azure Bloom copy 2')
    expect(nextCopyName('Azure Bloom copy 2', ['Azure Bloom copy', 'Azure Bloom copy 2']))
      .toBe('Azure Bloom copy 3')
  })

  it('ignores case and surrounding space when checking for collisions', () => {
    expect(nextCopyName('Azure Bloom', ['azure bloom COPY  '])).toBe('Azure Bloom copy 2')
  })

  it('fills a gap left by a deleted copy', () => {
    expect(nextCopyName('Azure Bloom', ['Azure Bloom', 'Azure Bloom copy 2'])).toBe('Azure Bloom copy')
  })
})
