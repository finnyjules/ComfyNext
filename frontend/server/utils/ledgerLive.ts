/**
 * The hosted-mode ledger: one createLedger instance over the one shared
 * Neon session (ledgerDb.ts). All hosted callers MUST go through this —
 * multiple ledger instances on one session can interleave transactions
 * (see the concurrency contract in ledger.ts).
 */
import { createLedger } from './ledger'
import { getSharedLedgerDb } from './ledgerDb'

let live: ReturnType<typeof createLedger> | null = null

export function getLiveLedger(): ReturnType<typeof createLedger> {
  if (!live) live = createLedger(getSharedLedgerDb())
  return live
}
