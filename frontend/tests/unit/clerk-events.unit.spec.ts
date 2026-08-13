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
    const res = await handleClerkEvent(evt, { sync })
    expect(res.handled).toBe(true)
    expect(sync).toHaveBeenCalledWith('user_123', 'primary@example.com')
  })

  it('user.created with no email still syncs (email null)', async () => {
    const sync = vi.fn().mockResolvedValue(undefined)
    const res = await handleClerkEvent(
      { type: 'user.created', data: { id: 'user_9', email_addresses: [] } }, { sync })
    expect(res.handled).toBe(true)
    expect(sync).toHaveBeenCalledWith('user_9', null)
  })

  it('other event types are acknowledged but not handled', async () => {
    const sync = vi.fn()
    const res = await handleClerkEvent({ type: 'session.created', data: { id: 'sess_1' } }, { sync })
    expect(res.handled).toBe(false)
    expect(sync).not.toHaveBeenCalled()
  })

  it('user.created without an id is rejected', async () => {
    const sync = vi.fn()
    await expect(handleClerkEvent({ type: 'user.created', data: {} }, { sync }))
      .rejects.toThrow(/user id/i)
  })
})
