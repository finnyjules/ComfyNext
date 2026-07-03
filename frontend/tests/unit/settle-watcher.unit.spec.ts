import { describe, it, expect, vi } from 'vitest'
import { settleOnCompletion } from '~~/server/utils/settleWatcher'

const noSleep = () => Promise.resolve()

describe('settleOnCompletion', () => {
  it('settles on a success status after a couple of empty polls', async () => {
    const seq = [null, null, { status: { status_str: 'success' as const, completed: true } }]
    let i = 0
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => seq[i++] ?? null,
      onSuccess, onError, sleep: noSleep, intervalMs: 0,
    })
    expect(r).toBe('success')
    expect(onSuccess).toHaveBeenCalledWith('p1')
    expect(onError).not.toHaveBeenCalled()
  })

  it('voids on an error status', async () => {
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => ({ status: { status_str: 'error', completed: true } }),
      onSuccess, onError, sleep: noSleep, intervalMs: 0,
    })
    expect(r).toBe('error')
    expect(onError).toHaveBeenCalledWith('p1')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('times out without charging when the run never completes', async () => {
    const onSuccess = vi.fn(); const onError = vi.fn()
    const r = await settleOnCompletion({
      promptId: 'p1', pollHistory: async () => null,
      onSuccess, onError, sleep: noSleep, intervalMs: 0, maxPolls: 3,
    })
    expect(r).toBe('timeout')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith('p1')
  })
})
