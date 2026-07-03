/**
 * In-memory registry of priced-but-unsettled graph runs, keyed by prompt_id.
 * Bridges the forward (Task 6) and the settlement (Task 5). Phase 5 replaces
 * this with the Postgres `holds`/pending rows so it survives a server restart.
 */
export interface PendingCharge {
  userId: string
  credits: number
  version: string
  status: 'pending' | 'settled' | 'voided'
}

const pending = new Map<string, PendingCharge>()

export const meterStore = {
  register(promptId: string, charge: Omit<PendingCharge, 'status'>): void {
    pending.set(promptId, { ...charge, status: 'pending' })
  },
  get(promptId: string): PendingCharge | undefined {
    return pending.get(promptId)
  },
  resolve(promptId: string, status: 'settled' | 'voided'): void {
    const c = pending.get(promptId)
    if (c) c.status = status
  },
  __reset(): void { pending.clear() },
}
