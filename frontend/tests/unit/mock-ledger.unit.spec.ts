import { describe, it, expect, beforeEach } from 'vitest'
import { mockLedger } from '~~/server/utils/mockLedger'

beforeEach(() => mockLedger.__reset())

describe('mockLedger', () => {
  it('credits and reports balance and available', () => {
    mockLedger.credit('u1', 150, 'signup_bonus', 'seed-u1')
    expect(mockLedger.getBalance('u1')).toBe(150)
    expect(mockLedger.getAvailable('u1')).toBe(150)
  })

  it('debits down to zero and rejects an overdraw', () => {
    mockLedger.__seed('u1', 10)
    expect(mockLedger.debit('u1', 4, 'generation', 'p-1')).toEqual({ ok: true, balance: 6 })
    expect(mockLedger.debit('u1', 99, 'generation', 'p-2')).toEqual({ ok: false, reason: 'insufficient' })
    expect(mockLedger.getBalance('u1')).toBe(6)
  })

  it('is idempotent on repeated debit with the same key', () => {
    mockLedger.__seed('u1', 10)
    const a = mockLedger.debit('u1', 3, 'generation', 'prompt-abc')
    const b = mockLedger.debit('u1', 3, 'generation', 'prompt-abc')
    expect(a).toEqual({ ok: true, balance: 7 })
    expect(b).toEqual({ ok: true, balance: 7 }) // no second charge
    expect(mockLedger.getBalance('u1')).toBe(7)
  })

  it('treats an unknown user as zero balance', () => {
    expect(mockLedger.getAvailable('nobody')).toBe(0)
    expect(mockLedger.debit('nobody', 1, 'generation', 'x')).toEqual({ ok: false, reason: 'insufficient' })
  })
})
