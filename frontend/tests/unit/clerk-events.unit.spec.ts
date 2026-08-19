import { describe, it, expect, vi } from 'vitest'
import { handleClerkEvent } from '../../server/utils/clerkEvents'

describe('handleClerkEvent', () => {
  it('user.created syncs the user with their primary email', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const evt = {
      type: 'user.created',
      data: {
        id: 'user_123',
        primary_email_address_id: 'idn_1',
        email_addresses: [
          { id: 'idn_0', email_address: 'other@example.com' },
          { id: 'idn_1', email_address: 'primary@example.com' },
        ],
      },
    }
    const res = await handleClerkEvent(evt, { sync, emailAllowed: () => true })
    expect(res.handled).toBe(true)
    expect(sync).toHaveBeenCalledWith('user_123', 'primary@example.com')
  })

  it('user.created with no email is rejected (fail closed)', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const res = await handleClerkEvent(
      { type: 'user.created', data: { id: 'user_9', email_addresses: [] } }, { sync, emailAllowed: () => true })
    expect(res.handled).toBe(false)
    expect(sync).not.toHaveBeenCalled()
  })

  it('other event types are acknowledged but not handled', async () => {
    const sync = vi.fn()
    const res = await handleClerkEvent({ type: 'session.created', data: { id: 'sess_1' } }, { sync, emailAllowed: () => true })
    expect(res.handled).toBe(false)
    expect(sync).not.toHaveBeenCalled()
  })

  it('user.created without an id is rejected', async () => {
    const sync = vi.fn()
    await expect(handleClerkEvent({ type: 'user.created', data: {} }, { sync, emailAllowed: () => true }))
      .rejects.toThrow(/user id/i)
  })
})

describe('beta allowlist at the webhook', () => {
  const evtFor = (email: string) => ({
    type: 'user.created',
    data: { id: 'user_m', primary_email_address_id: 'em_1', email_addresses: [{ id: 'em_1', email_address: email }] },
  })
  it('skips sync entirely for a non-listed email (no user row, no wallet, no bonus)', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(evtFor('mallory@evil.io'), { sync, emailAllowed: e => e === 'ada@example.com' })
    expect(res).toEqual({ handled: false })
    expect(sync).not.toHaveBeenCalled()
  })
  it('still syncs a listed email', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(evtFor('ada@example.com'), { sync, emailAllowed: e => e === 'ada@example.com' })
    expect(res).toEqual({ handled: true })
    expect(sync).toHaveBeenCalledWith('user_m', 'ada@example.com')
  })
  it('a user.created with NO email is skipped (fail closed)', async () => {
    const sync = vi.fn(async () => {})
    const res = await handleClerkEvent(
      { type: 'user.created', data: { id: 'user_x', email_addresses: [] } },
      { sync, emailAllowed: () => true },
    )
    expect(res).toEqual({ handled: false })
    expect(sync).not.toHaveBeenCalled()
  })
})
