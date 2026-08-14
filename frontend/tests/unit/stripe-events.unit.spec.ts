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

  it('a refused debit is never treated as recovered — result must be checked', async () => {
    const d = deps({ debit: vi.fn().mockResolvedValue({ ok: false, reason: 'insufficient' }) })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleStripeEvent({
      id: 'evt_6', type: 'charge.refunded',
      data: { object: { id: 'ch_2', customer: 'cus_9', amount_refunded: 500, refunds: { data: [{ id: 're_1', amount: 500 }] } } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback_partial' })
    expect(d.debit).toHaveBeenCalledWith('user_1', 500, 'refund_clawback', 're_1')
    expect(spy).toHaveBeenCalledWith('[stripe] CLAWBACK DEBIT REFUSED', { userId: 'user_1', refundId: 're_1', wanted: 500, eventId: 'evt_6' })
    spy.mockRestore()
  })

  it('a second charge.refunded event claws back only the NEW refund, keyed by refund id not event id', async () => {
    const d = deps()
    // First event: charge has one refund so far.
    const res1 = await handleStripeEvent({
      id: 'evt_7a', type: 'charge.refunded',
      data: { object: { id: 'ch_3', customer: 'cus_9', amount_refunded: 500, refunds: { data: [{ id: 're_10', amount: 500 }] } } },
    }, d)
    expect(res1).toEqual({ handled: true, action: 'clawback' })
    expect(d.debit).toHaveBeenNthCalledWith(1, 'user_1', 500, 'refund_clawback', 're_10')

    // Second event: a NEW partial refund lands on the same charge.
    // amount_refunded is now cumulative (1500), but refunds.data carries
    // both refunds individually — only re_11 should claw new money; re_10
    // is replayed (its key already exists, so the ledger's idempotency
    // makes that call a no-op in production) but must still be keyed by
    // re_10, never by the event id.
    const res2 = await handleStripeEvent({
      id: 'evt_7b', type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_3', customer: 'cus_9', amount_refunded: 1500,
          refunds: { data: [{ id: 're_10', amount: 500 }, { id: 're_11', amount: 1000 }] },
        },
      },
    }, d)
    expect(res2).toEqual({ handled: true, action: 'clawback' })
    expect(d.debit).toHaveBeenNthCalledWith(2, 'user_1', 500, 'refund_clawback', 're_10')
    expect(d.debit).toHaveBeenNthCalledWith(3, 'user_1', 1000, 'refund_clawback', 're_11')
    expect(d.debit).not.toHaveBeenCalledWith('user_1', expect.any(Number), 'refund_clawback', 'evt_7a')
    expect(d.debit).not.toHaveBeenCalledWith('user_1', expect.any(Number), 'refund_clawback', 'evt_7b')
  })

  it('refunds.data absent falls back to the cumulative amount, keyed by the EVENT id', async () => {
    const d = deps({ getAvailable: vi.fn().mockResolvedValue(100) })
    const res = await handleStripeEvent({
      id: 'evt_8', type: 'charge.refunded',
      data: { object: { id: 'ch_4', customer: 'cus_9', amount_refunded: 2500 } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback_partial' })
    expect(d.debit).toHaveBeenCalledWith('user_1', 100, 'refund_clawback', 'evt_8')
  })

  // Live finding (test-mode run 2026-08-13): current Stripe API versions do
  // NOT embed refunds.data on the charge — the fallback was the LIVE path.
  // When a listRefunds dep is provided, absent refunds.data must be fetched
  // from the API so debits stay keyed by refund ids (multi-partial-refund
  // safe), with the cumulative fallback reserved for fetch failure.
  it('refunds.data absent + listRefunds dep: fetches and keys by refund ids', async () => {
    const d = deps({
      listRefunds: vi.fn().mockResolvedValue([
        { id: 're_20', amount: 300 },
        { id: 're_21', amount: 700 },
      ]),
    })
    const res = await handleStripeEvent({
      id: 'evt_9', type: 'charge.refunded',
      data: { object: { id: 'ch_5', customer: 'cus_9', amount_refunded: 1000 } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback' })
    expect(d.listRefunds).toHaveBeenCalledWith('ch_5')
    expect(d.debit).toHaveBeenCalledWith('user_1', 300, 'refund_clawback', 're_20')
    expect(d.debit).toHaveBeenCalledWith('user_1', 700, 'refund_clawback', 're_21')
    expect(d.debit).not.toHaveBeenCalledWith('user_1', expect.any(Number), 'refund_clawback', 'evt_9')
  })

  it('listRefunds failure falls back to cumulative, loudly', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ listRefunds: vi.fn().mockRejectedValue(new Error('api down')) })
    const res = await handleStripeEvent({
      id: 'evt_10', type: 'charge.refunded',
      data: { object: { id: 'ch_6', customer: 'cus_9', amount_refunded: 400 } },
    }, d)
    expect(res).toEqual({ handled: true, action: 'clawback' })
    expect(d.debit).toHaveBeenCalledWith('user_1', 400, 'refund_clawback', 'evt_10')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('REFUND LIST FETCH FAILED'), expect.anything())
    spy.mockRestore()
  })
})
