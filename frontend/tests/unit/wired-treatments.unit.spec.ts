import { describe, it, expect } from 'vitest'
import { readWiredTreatments, setWiredMask, setWiredMaskShowSource, maskCandidateKeys } from '~/composables/useWiredTreatments'

function node() { return { data: { properties: {} as any } } }

describe('wired treatments store', () => {
  it('reads an empty map when unset', () => {
    expect(readWiredTreatments(node())).toEqual({})
  })
  it('writes and reads a wired mask ref keyed by w:<slot>', () => {
    const n = node()
    setWiredMask(n, 2, 'w:1')
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskedByKey: 'w:1' })
  })
  it('clears a wired mask ref when key is empty', () => {
    const n = node()
    setWiredMask(n, 2, 'w:1')
    setWiredMask(n, 2, '')
    expect(readWiredTreatments(n)['w:2']).toBeUndefined()
  })
  it('sets and clears showSource without losing maskedByKey', () => {
    const n = node()
    setWiredMask(n, 2, 'w:1')
    setWiredMaskShowSource(n, 2, true)
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskedByKey: 'w:1', showSource: true })
    setWiredMaskShowSource(n, 2, false)
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskedByKey: 'w:1' })
  })
})

describe('maskCandidateKeys', () => {
  it('returns every other layer key regardless of source, excluding self', () => {
    const present = ['w:1', 'w:2', 'l:abc']
    expect(maskCandidateKeys(present, 'w:1')).toEqual(['w:2', 'l:abc'])
    expect(maskCandidateKeys(present, 'l:abc')).toEqual(['w:1', 'w:2'])
  })
})
