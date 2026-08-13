/**
 * The mode-dependent half of the meter deps: where balances are read and
 * where the success debit lands. Local = in-memory mockLedger (spike
 * behavior, unchanged). Hosted = the real Neon ledger. Hosted with no live
 * ledger is a HARD error — a silent mock fallback would run paid jobs
 * against a toy wallet (graceful-fallback-hides-integration-failure).
 */
import { mockLedger } from './mockLedger'

export interface LiveLedgerSlice {
  getAvailable(userId: string): Promise<number>
  debit(userId: string, amount: number, reason: string, idempotencyKey: string): Promise<{ ok: boolean }>
}

export interface LedgerAdapters {
  getAvailable(userId: string): number | Promise<number>
  debitOnSuccess(userId: string, credits: number, version: string, promptId: string): Promise<{ ok: boolean }>
}

export function buildLedgerAdapters(mode: 'local' | 'hosted', live?: LiveLedgerSlice): LedgerAdapters {
  if (mode === 'hosted') {
    if (!live) throw new Error('meterWiring: hosted mode requires the live ledger')
    return {
      getAvailable: u => live.getAvailable(u),
      debitOnSuccess: (u, credits, version, promptId) =>
        live.debit(u, credits, `graph_run:${version}`, promptId),
    }
  }
  return {
    getAvailable: u => mockLedger.getAvailable(u),
    debitOnSuccess: async (u, credits, version, promptId) =>
      mockLedger.debit(u, credits, `graph_run:${version}`, promptId),
  }
}
