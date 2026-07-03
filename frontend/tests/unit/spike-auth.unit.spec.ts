import { describe, it, expect } from 'vitest'
import { resolveSpikeUser, stripForeignComfyOrgCreds } from '~~/server/utils/spikeAuth'

describe('resolveSpikeUser', () => {
  it('reads the user id from x-spike-user', () => {
    expect(resolveSpikeUser({ 'x-spike-user': 'u1' })).toBe('u1')
  })
  it('returns null when the header is absent or blank', () => {
    expect(resolveSpikeUser({})).toBeNull()
    expect(resolveSpikeUser({ 'x-spike-user': '  ' })).toBeNull()
  })
})

describe('stripForeignComfyOrgCreds', () => {
  it('removes an operator/foreign comfy.org credential the caller did not supply', () => {
    const out = stripForeignComfyOrgCreds({ auth_token_comfy_org: 'OPERATOR', client_id: 'c1' }, null)
    expect(out).toEqual({ client_id: 'c1' })
  })
  it('passes through the caller-supplied key unchanged', () => {
    const out = stripForeignComfyOrgCreds({ api_key_comfy_org: 'MINE', client_id: 'c1' }, 'MINE')
    expect(out).toEqual({ api_key_comfy_org: 'MINE', client_id: 'c1' })
  })
  it('handles missing extra_data', () => {
    expect(stripForeignComfyOrgCreds(undefined, null)).toEqual({})
  })
})
