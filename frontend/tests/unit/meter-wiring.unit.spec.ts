import { describe, it, expect, vi } from 'vitest'
import { buildLedgerAdapters } from '../../server/utils/meterWiring'
import { mockLedger } from '../../server/utils/mockLedger'

describe('buildLedgerAdapters', () => {
  it('local mode reads and debits the mock ledger', async () => {
    const a = buildLedgerAdapters('local')
    mockLedger.__reset()
    mockLedger.credit('u1', 100, 'seed', 'k0')
    expect(await a.getAvailable('u1')).toBe(100)
    const r = await a.debitOnSuccess('u1', 40, 'v1', 'prompt-1')
    expect(r.ok).toBe(true)
    expect(await a.getAvailable('u1')).toBe(60)
  })

  it('hosted mode uses the injected live ledger with graph_run reason + promptId key', async () => {
    const live = {
      getAvailable: vi.fn().mockResolvedValue(250),
      debit: vi.fn().mockResolvedValue({ ok: true, balance: 210 }),
    }
    const a = buildLedgerAdapters('hosted', live)
    expect(await a.getAvailable('u2')).toBe(250)
    await a.debitOnSuccess('u2', 40, 'v2', 'prompt-9')
    expect(live.debit).toHaveBeenCalledWith('u2', 40, 'graph_run:v2', 'prompt-9')
  })

  it('hosted mode without a live ledger is a hard error (no silent mock fallback)', () => {
    expect(() => buildLedgerAdapters('hosted')).toThrow(/live ledger/i)
  })
})
