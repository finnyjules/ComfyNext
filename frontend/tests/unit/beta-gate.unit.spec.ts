import { describe, expect, it } from 'vitest'
import { isBetaGateError } from '../../app/lib/betaGate'

describe('isBetaGateError', () => {
  it('recognizes the middleware refusal in both h3 body nestings', () => {
    expect(isBetaGateError({ statusCode: 403, data: { data: { code: 'beta_not_invited' } } })).toBe(true)
    expect(isBetaGateError({ statusCode: 403, data: { code: 'beta_not_invited' } })).toBe(true)
  })
  it('ignores other errors — plain 403s, 401s, network failures, junk', () => {
    expect(isBetaGateError({ statusCode: 403, data: { data: { code: 'other' } } })).toBe(false)
    expect(isBetaGateError({ statusCode: 401 })).toBe(false)
    expect(isBetaGateError(new Error('network'))).toBe(false)
    expect(isBetaGateError(null)).toBe(false)
  })
})
