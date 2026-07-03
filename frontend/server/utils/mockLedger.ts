/**
 * In-memory mock of the real ledger (spec §5.2). Same public surface —
 * getBalance / getAvailable / credit / debit — so Phase 2 replaces the guts
 * with Postgres + SELECT…FOR UPDATE without changing any caller. Idempotency
 * keys dedupe retries/double-submits. No holds in the spike → available == balance.
 */
export type LedgerResult = { ok: true; balance: number } | { ok: false; reason: 'insufficient' }

interface Wallet { balance: number }

const wallets = new Map<string, Wallet>()
const seenKeys = new Map<string, number>() // idempotencyKey → balance-after (for replay)

function wallet(userId: string): Wallet {
  let w = wallets.get(userId)
  if (!w) { w = { balance: 0 }; wallets.set(userId, w) }
  return w
}

export const mockLedger = {
  getBalance(userId: string): number {
    return wallets.get(userId)?.balance ?? 0
  },
  // reserved is always 0 in the spike; the name is the Phase-2 contract.
  getAvailable(userId: string): number {
    return this.getBalance(userId)
  },
  credit(userId: string, amount: number, _reason: string, idempotencyKey: string): LedgerResult {
    if (seenKeys.has(idempotencyKey)) return { ok: true, balance: seenKeys.get(idempotencyKey)! }
    const w = wallet(userId)
    w.balance += amount
    seenKeys.set(idempotencyKey, w.balance)
    return { ok: true, balance: w.balance }
  },
  debit(userId: string, amount: number, _reason: string, idempotencyKey: string): LedgerResult {
    if (seenKeys.has(idempotencyKey)) return { ok: true, balance: seenKeys.get(idempotencyKey)! }
    const w = wallet(userId)
    if (amount > w.balance) return { ok: false, reason: 'insufficient' }
    w.balance -= amount
    seenKeys.set(idempotencyKey, w.balance)
    return { ok: true, balance: w.balance }
  },
  __reset(): void { wallets.clear(); seenKeys.clear() },
  __seed(userId: string, credits: number): void { wallet(userId).balance = credits },
}
