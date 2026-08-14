import { describe, it, expect, vi } from 'vitest'
import { handleStripeEvent } from '../../server/utils/stripeEvents'

function deps(overrides: Partial<Record<string, any>> = {}) {
  return {
    credit: vi.fn().mockResolvedValue({ ok: true, balance: 1000 }),
    debit: vi.fn().mockResolvedValue({ ok: true, balance: 0 }),
    getAvailable: vi.fn().mockResolvedValue(1000),
    lookupUserByCustomer: vi.fn().mockResolvedValue('user_1'),
    ...overrides,
  }
}

describe('handleStripeEvent', () => {
  it('checkout.session.completed grants the pack keyed by EVENT id', async () => {
    const d = deps()
    const res = await handleStripeEvent({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { userId: 'user_1', packId: 'creator', credits: '2750' } } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'granted' })
    expect(d.credit).toHaveBeenCalledWith('user_1', 2750, 'pack_purchase:creator', 'evt_1')
  })

  it('unpaid session is acknowledged but grants nothing', async () => {
    const d = deps()
    const res = await handleStripeEvent({
      id: 'evt_2', type: 'checkout.session.completed',
      data: { object: { id: 'cs_2', payment_status: 'unpaid', metadata: { userId: 'user_1', packId: 'creator', credits: '2750' } } },
    }, d)
    expect(res.handled).toBe(false)
    expect(d.credit).not.toHaveBeenCalled()
  })

  it('metadata credits must match the pack table (tamper guard)', async () => {
    const d = deps()
    await expect(handleStripeEvent({
      id: 'evt_3', type: 'checkout.session.completed',
      data: { object: { id: 'cs_3', payment_status: 'paid', metadata: { userId: 'user_1', packId: 'creator', credits: '999999' } } },
    }, d)).rejects.toThrow(/pack mismatch/i)
    expect(d.credit).not.toHaveBeenCalled()
  })

  it('charge.refunded claws back up to the available balance and reports shortfall', async () => {
    const d = deps({ getAvailable: vi.fn().mockResolvedValue(100) })
    const res = await handleStripeEvent({
      id: 'evt_4', type: 'charge.refunded',
      data: { object: { id: 'ch_1', customer: 'cus_9', amount_refunded: 2500 } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback_partial' })
    // $25 refunded = 2500 base credits owed back, but only 100 available
    expect(d.debit).toHaveBeenCalledWith('user_1', 100, 'refund_clawback', 'evt_4')
  })

  it('unknown event types are acknowledged, unhandled', async () => {
    const d = deps()
    expect((await handleStripeEvent({ id: 'evt_5', type: 'invoice.created', data: { object: {} } }, d)).handled).toBe(false)
  })
})
