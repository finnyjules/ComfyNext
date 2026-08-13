/**
 * The signed-in user's wallet (balance + available = balance − open holds).
 * Local mode reports { mode: 'local' } so the client renders no wallet UI.
 */
import { deployMode } from '~~/server/utils/deployMode'
import { getLiveLedger } from '~~/server/utils/ledgerLive'

interface WalletLedger {
  getBalance(userId: string): Promise<number>
  getAvailable(userId: string): Promise<number>
}

export async function walletPayload(
  mode: 'local' | 'hosted',
  userId: string | null,
  ledger: WalletLedger,
): Promise<{ mode: 'local' } | { mode: 'hosted'; balance: number; available: number }> {
  if (mode === 'local') return { mode: 'local' }
  if (!userId) {
    const err: any = new Error('Sign in required')
    err.statusCode = 401
    throw err
  }
  const [balance, available] = await Promise.all([
    ledger.getBalance(userId),
    ledger.getAvailable(userId),
  ])
  return { mode: 'hosted', balance, available }
}

export default defineEventHandler(async (event) => {
  const mode = deployMode()
  return walletPayload(
    mode,
    event.context.userId ?? null,
    mode === 'hosted' ? getLiveLedger() : (null as never),
  )
})
