import { describe, it, expect, beforeEach, vi } from 'vitest'
import { moderatePrompt, __setModerationFetchForTests } from '../../server/utils/moderation'

beforeEach(() => { __setModerationFetchForTests(null); delete process.env.OPENAI_API_KEY })

describe('moderatePrompt', () => {
  it('no key → ok (no-op, no fetch)', async () => {
    const spy = vi.fn(); __setModerationFetchForTests(spy)
    expect(await moderatePrompt('anything')).toEqual({ ok: true })
    expect(spy).not.toHaveBeenCalled()
  })
  it('empty text → ok, no fetch', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'; const spy = vi.fn(); __setModerationFetchForTests(spy)
    expect(await moderatePrompt('   ')).toEqual({ ok: true })
    expect(spy).not.toHaveBeenCalled()
  })
  it('flagged → not ok with categories', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    __setModerationFetchForTests(vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ flagged: true, categories: { violence: true, hate: false } }] }) }))
    expect(await moderatePrompt('bad')).toEqual({ ok: false, categories: ['violence'] })
  })
  it('OpenAI error → FAIL-OPEN (ok:true)', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    __setModerationFetchForTests(vi.fn().mockRejectedValue(new Error('down')))
    expect(await moderatePrompt('x')).toEqual({ ok: true })
  })
  it('non-200 → FAIL-OPEN', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    __setModerationFetchForTests(vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }))
    expect(await moderatePrompt('x')).toEqual({ ok: true })
  })
})
