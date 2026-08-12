import { afterEach, describe, expect, it } from 'vitest'
import { deployMode, isHosted } from '../../server/utils/deployMode'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const saved = process.env[KEY]

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

describe('deployMode', () => {
  it('is local when no Clerk key is set — the non-negotiable default', () => {
    delete process.env[KEY]
    expect(deployMode()).toBe('local')
    expect(isHosted()).toBe(false)
  })

  it('is local when the key is empty or whitespace', () => {
    process.env[KEY] = '   '
    expect(deployMode()).toBe('local')
  })

  it('is hosted when a Clerk secret key is present', () => {
    process.env[KEY] = 'sk_test_abc123'
    expect(deployMode()).toBe('hosted')
    expect(isHosted()).toBe(true)
  })
})
