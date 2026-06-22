import { describe, it, expect } from 'vitest'
import { selectGeneratableStyles } from '../../app/composables/useStyleList'

const rec = (p: any) => ({
  filename: 'x.safetensors', name: 'X', kind: 'style', coverUrl: null,
  canGenerateCover: true, trigger: null, aesthetic: null, ...p,
})

describe('selectGeneratableStyles', () => {
  it('keeps runnable styles', () => {
    const out = selectGeneratableStyles([rec({ filename: 'a.safetensors', name: 'A' })])
    expect(out).toEqual([{ filename: 'a.safetensors', name: 'A', coverUrl: null }])
  })
  it('drops characters', () => {
    expect(selectGeneratableStyles([rec({ kind: 'character' })])).toEqual([])
  })
  it('drops styles with no trained model', () => {
    expect(selectGeneratableStyles([rec({ canGenerateCover: false })])).toEqual([])
  })
  it('tolerates non-array input', () => {
    expect(selectGeneratableStyles(undefined as any)).toEqual([])
  })
})
