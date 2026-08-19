/**
 * Stage 7 Task 5: nightly spend digest. `reconcileDay` is a DIGEST, not a
 * true reconciliation — `chargedCredits` (ledger debits) is the COMPLETE
 * daily total; `providerUsd`/`byProvider` (provider_usage) is DIRECT-ROUTE
 * detail only (misses training/canvas/bypass spend). `unmatchedJobIds` is a
 * narrow leak check: a provider_usage row with no matching ledger debit,
 * joined on `provider_usage.job_id = ledger_entries.idempotency_key`, both
 * `settle:<holdId>` (Task 1 verified against ledger.ts's `settle()`).
 */
import { describe, it, expect, vi } from 'vitest'
import { reconcileDay } from '../../server/utils/reconcile'

function makeQuery(opts: {
  ledgerCredits?: number
  usageRows?: Array<{ provider: string; job_id: string; usd: number }>
  matchedKeys?: string[]
}) {
  const usageRows = opts.usageRows ?? []
  const matchedKeys = opts.matchedKeys ?? []
  return vi.fn(async (sql: string, params?: unknown[]) => {
    if (/FROM ledger_entries/i.test(sql) && /SUM\(amount\)/i.test(sql)) {
      return { rows: [{ c: opts.ledgerCredits ?? 0 }] }
    }
    if (/FROM provider_usage/i.test(sql)) {
      return { rows: usageRows }
    }
    if (/FROM ledger_entries/i.test(sql) && /idempotency_key/i.test(sql)) {
      const ids = (params?.[0] as string[]) ?? []
      const rows = ids.filter(id => matchedKeys.includes(id)).map(idempotency_key => ({ idempotency_key }))
      return { rows }
    }
    throw new Error(`unexpected query: ${sql}`)
  })
}

describe('reconcileDay', () => {
  it('flags a provider_usage row with no matching ledger debit', async () => {
    const usageRows = [
      { provider: 'replicate', job_id: 'settle:1', usd: 0.02 },
      { provider: 'fal', job_id: 'settle:2', usd: 0.03 },
      { provider: 'replicate', job_id: 'settle:3', usd: 0.01 },
    ]
    const query = makeQuery({
      ledgerCredits: 42,
      usageRows,
      matchedKeys: ['settle:1', 'settle:2'],
    })

    const result = await reconcileDay({ query })

    expect(result.unmatchedJobIds).toEqual(['settle:3'])
    expect(result.chargedCredits).toBe(42)
    expect(result.providerUsd).toBeCloseTo(0.06)
    expect(result.byProvider).toEqual({ replicate: 0.03, fal: 0.03 })
  })

  it('empty day returns an empty result with no unmatched and zero sums', async () => {
    const query = makeQuery({ ledgerCredits: 0, usageRows: [], matchedKeys: [] })

    const result = await reconcileDay({ query })

    expect(result).toEqual({
      unmatchedJobIds: [],
      providerUsd: 0,
      chargedCredits: 0,
      byProvider: {},
    })
    // No unmatched-check query is needed when there are no usage rows at all.
    expect(query.mock.calls.filter(c => /idempotency_key/i.test(String(c[0]))).length).toBe(0)
  })

  it('all provider_usage rows match a ledger debit — no unmatched', async () => {
    const usageRows = [
      { provider: 'replicate', job_id: 'settle:10', usd: 0.5 },
      { provider: 'replicate', job_id: 'settle:11', usd: 0.5 },
    ]
    const query = makeQuery({
      ledgerCredits: 10,
      usageRows,
      matchedKeys: ['settle:10', 'settle:11'],
    })

    const result = await reconcileDay({ query })

    expect(result.unmatchedJobIds).toEqual([])
    expect(result.providerUsd).toBeCloseTo(1)
    expect(result.byProvider).toEqual({ replicate: 1 })
  })

  it('excludes expiry debits from chargedCredits — only real spend counts', async () => {
    // A day with a 15-credit real spend debit and a separate 25-credit
    // credit-expiry debit (ledger.ts expireCredits, reason='expiry'). Expiry
    // is credits lapsing worthless, not provider spend — it must not inflate
    // the digest's chargedCredits total. See systemControls.ts's identical
    // exclusion on the ceiling sum.
    const debitRows = [
      { reason: 'settle:1', amount: 15 },
      { reason: 'expiry', amount: 25 },
    ]
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (/FROM ledger_entries/i.test(sql) && /SUM\(amount\)/i.test(sql)) {
        const excludesExpiry = /reason\s*<>\s*'expiry'/i.test(sql)
        const rows = excludesExpiry ? debitRows.filter(r => r.reason !== 'expiry') : debitRows
        const sum = rows.reduce((s, r) => s + r.amount, 0)
        return { rows: [{ c: sum }] }
      }
      if (/FROM provider_usage/i.test(sql)) return { rows: [] }
      if (/FROM ledger_entries/i.test(sql) && /idempotency_key/i.test(sql)) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })

    const result = await reconcileDay({ query })

    expect(result.chargedCredits).toBe(15)
  })

  it('accepts an injected now() without needing it to affect the fake', async () => {
    const query = makeQuery({ ledgerCredits: 5, usageRows: [], matchedKeys: [] })
    const now = vi.fn(() => new Date('2026-08-18T00:00:00Z'))

    const result = await reconcileDay({ query, now })

    expect(result.chargedCredits).toBe(5)
    expect(now).toHaveBeenCalled()
  })
})
