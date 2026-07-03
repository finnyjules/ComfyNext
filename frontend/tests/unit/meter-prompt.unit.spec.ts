import { describe, it, expect, vi } from 'vitest'
import { meterPrompt, MeterError } from '~~/server/utils/meterPrompt'

function deps(over: Partial<any> = {}) {
  return {
    priceGraph: () => ({ credits: 4, version: 'spike-v1', breakdown: [] }),
    getAvailable: () => 100,
    register: vi.fn(),
    forward: vi.fn(async () => ({ prompt_id: 'PID-1' })),
    settle: vi.fn(),
    ...over,
  }
}
const body = { prompt: { '1': { class_type: 'KSampler' }, '2': { class_type: 'SaveImage' } } }

describe('meterPrompt', () => {
  it('prices, preflights, forwards, registers, settles', async () => {
    const d = deps()
    const r = await meterPrompt('u1', body, d)
    expect(r).toEqual({ promptId: 'PID-1', credits: 4, version: 'spike-v1' })
    expect(d.forward).toHaveBeenCalledOnce()
    expect(d.register).toHaveBeenCalledWith('PID-1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    expect(d.settle).toHaveBeenCalledWith('PID-1', 'u1', 4, 'spike-v1')
  })

  it('rejects an unauthenticated caller before doing anything', async () => {
    const d = deps()
    await expect(meterPrompt(null, body, d)).rejects.toMatchObject({ code: 'unauthorized' })
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('refuses insufficient balance WITHOUT forwarding', async () => {
    const d = deps({ getAvailable: () => 1 }) // price 4 > 1
    await expect(meterPrompt('u1', body, d)).rejects.toMatchObject({ code: 'insufficient', available: 1, required: 4 })
    expect(d.forward).not.toHaveBeenCalled()
    expect(d.register).not.toHaveBeenCalled()
  })

  it('rejects a malformed body', async () => {
    await expect(meterPrompt('u1', {}, deps())).rejects.toBeInstanceOf(MeterError)
  })
})
