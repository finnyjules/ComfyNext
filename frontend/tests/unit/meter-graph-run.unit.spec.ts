import { describe, it, expect, vi } from 'vitest'
import { meterGraphSubmit, isPromptPath } from '../../server/utils/meterGraphRun'
import { MeterRefusalError } from '../../server/utils/requestMeter'
import { UnpricedGraphError } from '../../server/utils/priceBook'

function deps(overrides: Partial<any> = {}) {
  return {
    priceGraph: vi.fn(() => ({ credits: 5, version: 'test-v1', breakdown: [] })),
    hold: vi.fn(async () => ({ ok: true as const, holdId: 7 })),
    getAvailable: vi.fn(async () => 3),
    forward: vi.fn(async () => ({ status: 200, body: { prompt_id: 'p1', number: 1, node_errors: {} } })),
    registerRun: vi.fn(async () => {}),
    startSettle: vi.fn(),
    releaseHold: vi.fn(async () => {}),
    ...overrides,
  }
}
const BODY = { prompt: { '1': { class_type: 'SaveImage', inputs: {} } }, client_id: 'c1' }

describe('meterGraphSubmit', () => {
  it('refuses without a user (401)', async () => {
    await expect(meterGraphSubmit(null, BODY, deps())).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects a malformed body (no prompt graph)', async () => {
    await expect(meterGraphSubmit('u1', {}, deps())).rejects.toMatchObject({ statusCode: 400 })
  })

  it('holds before forwarding and returns ComfyUI body verbatim', async () => {
    const d = deps()
    const res = await meterGraphSubmit('u1', BODY, d)
    expect(d.hold).toHaveBeenCalledWith('u1', 5)
    expect(d.hold.mock.invocationCallOrder[0]).toBeLessThan(d.forward.mock.invocationCallOrder[0])
    expect(res).toEqual({ status: 200, body: { prompt_id: 'p1', number: 1, node_errors: {} } })
    expect(d.registerRun).toHaveBeenCalledWith({ promptId: 'p1', userId: 'u1', credits: 5, holdId: 7 })
    expect(d.startSettle).toHaveBeenCalledWith({ promptId: 'p1', holdId: 7, credits: 5 })
  })

  it('insufficient hold → 402 carrying required/available, engine never touched', async () => {
    const d = deps({ hold: vi.fn(async () => ({ ok: false as const, reason: 'insufficient' as const })) })
    await expect(meterGraphSubmit('u1', BODY, d)).rejects.toMatchObject({
      statusCode: 402, data: { required: 5, available: 3 },
    })
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('UnpricedGraphError → 500 refusal, engine never touched', async () => {
    const d = deps({ priceGraph: vi.fn(() => { throw new UnpricedGraphError('MysteryNode') }) })
    await expect(meterGraphSubmit('u1', BODY, d)).rejects.toBeInstanceOf(MeterRefusalError)
    expect(d.forward).not.toHaveBeenCalled()
  })

  it('ComfyUI 400 (validation) → hold released, error body passed through verbatim', async () => {
    const errBody = { error: { message: 'bad' }, node_errors: { '1': {} } }
    const d = deps({ forward: vi.fn(async () => ({ status: 400, body: errBody })) })
    const res = await meterGraphSubmit('u1', BODY, d)
    expect(res).toEqual({ status: 400, body: errBody })
    expect(d.releaseHold).toHaveBeenCalledWith(7)
    expect(d.registerRun).not.toHaveBeenCalled()
  })

  it('zero-credit graph skips the hold but still registers ownership', async () => {
    const d = deps({ priceGraph: vi.fn(() => ({ credits: 0, version: 'test-v1', breakdown: [] })) })
    await meterGraphSubmit('u1', BODY, d)
    expect(d.hold).not.toHaveBeenCalled()
    expect(d.registerRun).toHaveBeenCalledWith({ promptId: 'p1', userId: 'u1', credits: 0, holdId: null })
  })
})

describe('isPromptPath', () => {
  it('matches /prompt and /prompt?comfyWorker=2, not /prompted', () => {
    expect(isPromptPath('/prompt')).toBe(true)
    expect(isPromptPath('/prompt?comfyWorker=2')).toBe(true)
    expect(isPromptPath('/prompted')).toBe(false)
  })
})
