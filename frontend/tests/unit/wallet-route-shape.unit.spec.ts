import { beforeAll, describe, it, expect } from 'vitest'

/**
 * wallet.get.ts calls defineEventHandler at module scope (a Nitro auto-import that
 * doesn't exist under plain vitest). Stub it before dynamic import, per the
 * auth-middleware-helpers.unit.spec.ts pattern.
 */
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn

let walletPayload: any

const fakeLedger = {
  getBalance: async (_u: string) => 700,
  getAvailable: async (_u: string) => 500,
} as any

beforeAll(async () => {
  ({ walletPayload } = await import('../../server/api/wallet.get'))
})

describe('walletPayload', () => {
  it('local mode reports local with no numbers', async () => {
    expect(await walletPayload('local', null, fakeLedger)).toEqual({ mode: 'local' })
  })
  it('hosted + user returns balance and available', async () => {
    expect(await walletPayload('hosted', 'user_1', fakeLedger))
      .toEqual({ mode: 'hosted', balance: 700, available: 500 })
  })
  it('hosted without a user throws 401-shaped error', async () => {
    await expect(walletPayload('hosted', null, fakeLedger)).rejects.toMatchObject({ statusCode: 401 })
  })
})
