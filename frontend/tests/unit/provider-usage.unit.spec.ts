import { describe, it, expect, beforeEach, vi } from 'vitest'
import { recordProviderUsage, __setProviderUsageDbForTests } from '../../server/utils/providerUsage'

const query = vi.fn()
beforeEach(() => { query.mockReset(); __setProviderUsageDbForTests({ query }) })

describe('recordProviderUsage', () => {
  it('inserts a row with the provider/model/usd/job/user', async () => {
    query.mockResolvedValue({ rows: [] })
    await recordProviderUsage({ userId: 'u1', provider: 'replicate', model: 'black-forest-labs/flux-dev', usd: 0.025, jobId: 'rep:abc' })
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO provider_usage/i)
    expect(params).toEqual(['u1', 'replicate', 'black-forest-labs/flux-dev', 0.025, 'rep:abc'])
  })
  it('tolerates a null user and null usd', async () => {
    query.mockResolvedValue({ rows: [] })
    await recordProviderUsage({ userId: null, provider: 'fal', model: 'x', usd: null, jobId: 'fal:1' })
    expect(query.mock.calls[0][1]).toEqual([null, 'fal', 'x', null, 'fal:1'])
  })
  it('swallows and logs an insert failure without throwing', async () => {
    query.mockRejectedValue(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordProviderUsage({ userId: 'u1', provider: 'replicate', model: 'm', usd: 0.01, jobId: 'rep:x' })).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
