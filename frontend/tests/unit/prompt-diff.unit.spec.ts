import { describe, it, expect, vi, beforeEach } from 'vitest'
import { diffPrompts } from '~/lib/graph/promptDiff'
import type { ApiPrompt } from '~/lib/graph/graphToPrompt'
import { useShadowParity } from '~/composables/useShadowParity'

describe('diffPrompts', () => {
  it('returns [] for identical prompts', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
  })

  it('ignores object key order', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { steps: 20, seed: 1 } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
  })

  it('treats null vs missing key as benign-equal', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, extra: null } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
    // symmetric: missing in ours, null in theirs
    expect(diffPrompts(theirs, ours)).toEqual([])
  })

  it('reports a value mismatch with nodeId and field', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 30 } },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '1', field: 'inputs.steps', ours: 20, theirs: 30 },
    ])
  })

  it('treats numeric 1 vs string "1" as a real divergence', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: 1 } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { seed: '1' } },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '1', field: 'inputs.seed', ours: 1, theirs: '1' },
    ])
  })

  it('reports an extra node present only in ours', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: {} },
      '2': { class_type: 'SaveImage', inputs: {} },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: {} },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '2', field: '<node>', ours: { class_type: 'SaveImage', inputs: {} }, theirs: undefined },
    ])
  })

  it('reports a missing node absent from ours', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: {} },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: {} },
      '2': { class_type: 'SaveImage', inputs: {} },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '2', field: '<node>', ours: undefined, theirs: { class_type: 'SaveImage', inputs: {} } },
    ])
  })

  it('compares link-value arrays element-wise and reports mismatches', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { model: ['4', 0] } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { model: ['5', 0] } },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '1', field: 'inputs.model', ours: ['4', 0], theirs: ['5', 0] },
    ])
  })

  it('does not report equal link-value arrays', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { model: ['4', 0] } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { model: ['4', 0] } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
  })

  it('reports class_type mismatch', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: {} },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSamplerAdvanced', inputs: {} },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '1', field: 'class_type', ours: 'KSampler', theirs: 'KSamplerAdvanced' },
    ])
  })

  it('treats identical nested plain objects as equal', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'Custom', inputs: { config: { a: 1, b: 2 } } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'Custom', inputs: { config: { b: 2, a: 1 } } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
  })

  it('reports divergence for differing nested object values', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'Custom', inputs: { config: { a: 1, b: 2 } } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'Custom', inputs: { config: { a: 1, b: 3 } } },
    }
    const divergences = diffPrompts(ours, theirs)
    expect(divergences).toEqual([
      { nodeId: '1', field: 'inputs.config', ours: { a: 1, b: 2 }, theirs: { a: 1, b: 3 } },
    ])
  })

  it('treats both-NaN as equal', () => {
    const ours: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { value: NaN } },
    }
    const theirs: ApiPrompt = {
      '1': { class_type: 'KSampler', inputs: { value: NaN } },
    }
    expect(diffPrompts(ours, theirs)).toEqual([])
  })
})

describe('useShadowParity', () => {
  beforeEach(() => {
    // Reset the module-level singleton log between tests.
    const { log } = useShadowParity()
    log.value.splice(0, log.value.length)
  })

  it('records an entry with label, timestamp, and divergences', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { record, log } = useShadowParity()
    const ours: ApiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }
    const theirs: ApiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 2 } } }
    record(ours, theirs, 'test-run')
    expect(log.value.length).toBe(1)
    expect(log.value[0].label).toBe('test-run')
    expect(typeof log.value[0].at).toBe('number')
    expect(log.value[0].divergences).toEqual([
      { nodeId: '1', field: 'inputs.seed', ours: 1, theirs: 2 },
    ])
    warnSpy.mockRestore()
  })

  it('shares state across separate useShadowParity() calls (module singleton)', () => {
    const a = useShadowParity()
    const b = useShadowParity()
    const ours: ApiPrompt = { '1': { class_type: 'KSampler', inputs: {} } }
    a.record(ours, ours, 'shared')
    expect(b.log.value.length).toBe(1)
    expect(b.log.value[0].label).toBe('shared')
  })

  it('trims the ring buffer to the last 50 entries', () => {
    const { record, log } = useShadowParity()
    const ours: ApiPrompt = { '1': { class_type: 'KSampler', inputs: {} } }
    for (let i = 0; i < 55; i++) {
      record(ours, ours, `entry-${i}`)
    }
    expect(log.value.length).toBe(50)
    expect(log.value[0].label).toBe('entry-5')
    expect(log.value[49].label).toBe('entry-54')
  })

  it('does not warn when there are no divergences', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { record } = useShadowParity()
    const ours: ApiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }
    record(ours, ours, 'no-warn')
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('warns via console.warn with [shadow-parity] prefix when divergences exist', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { record } = useShadowParity()
    const ours: ApiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 1 } } }
    const theirs: ApiPrompt = { '1': { class_type: 'KSampler', inputs: { seed: 2 } } }
    record(ours, theirs, 'warn-case')
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith('[shadow-parity]', 'warn-case', [
      { nodeId: '1', field: 'inputs.seed', ours: 1, theirs: 2 },
    ])
    warnSpy.mockRestore()
  })
})
