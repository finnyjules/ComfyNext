import { beforeAll, describe, it, expect } from 'vitest'
import { PACKS } from '../../server/utils/packs'

/**
 * packs.get.ts calls defineEventHandler at module scope (a Nitro auto-import
 * that doesn't exist under plain vitest). Stub it before dynamic import, per
 * the wallet-route-shape.unit.spec.ts pattern.
 */
const g = globalThis as any
g.defineEventHandler = (fn: any) => fn

let packsPayload: () => { packs: typeof PACKS }

beforeAll(async () => {
  ({ packsPayload } = await import('../../server/api/billing/packs.get'))
})

describe('packsPayload', () => {
  it('returns the decided ladder verbatim', () => {
    expect(packsPayload()).toEqual({ packs: PACKS })
  })
})
