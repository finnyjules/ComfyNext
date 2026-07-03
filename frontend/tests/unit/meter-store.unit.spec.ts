import { describe, it, expect, beforeEach } from 'vitest'
import { meterStore } from '~~/server/utils/meterStore'

beforeEach(() => meterStore.__reset())

describe('meterStore', () => {
  it('registers a pending charge and reads it back', () => {
    meterStore.register('p1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    expect(meterStore.get('p1')).toEqual({ userId: 'u1', credits: 4, version: 'spike-v1', status: 'pending' })
  })

  it('resolves a charge to settled or voided', () => {
    meterStore.register('p1', { userId: 'u1', credits: 4, version: 'spike-v1' })
    meterStore.resolve('p1', 'settled')
    expect(meterStore.get('p1')?.status).toBe('settled')
  })

  it('returns undefined for an unknown prompt id', () => {
    expect(meterStore.get('nope')).toBeUndefined()
  })
})
