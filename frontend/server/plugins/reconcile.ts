/**
 * Nightly spend-digest cron (Stage 7 Task 5). Logs the day's total ledger
 * debit credits + per-provider USD breakdown, and flags any provider_usage
 * row with no matching ledger debit (a narrow code-regression leak check) —
 * see reconcile.ts for why this is a DIGEST, not a true reconciliation.
 *
 * Hosted-only, and deliberately nothing runs during boot: startReconcileCron
 * only schedules callbacks (see reconcile.ts), so a slow or unreachable
 * ledger can never delay or fail Nitro startup.
 *
 * A module singleton on globalThis guards against Nitro HMR spawning
 * duplicate timers in dev — the holdSweep.ts pattern.
 */
import { startReconcileCron } from '../utils/reconcile'

const g = globalThis as unknown as { __sailorReconcileStarted?: boolean }

export default defineNitroPlugin(() => {
  if (g.__sailorReconcileStarted) return
  if (!startReconcileCron()) return // local mode — nothing scheduled
  g.__sailorReconcileStarted = true
})
