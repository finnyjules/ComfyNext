import { describe, it, expect } from 'vitest'
import { hostedModeEnabled, engineOrigin } from '../../app/lib/hostedMode'

describe('hostedModeEnabled', () => {
  it('is true only for boolean true', () => {
    expect(hostedModeEnabled({ hostedMode: true })).toBe(true)
    expect(hostedModeEnabled({ hostedMode: false })).toBe(false)
    expect(hostedModeEnabled({})).toBe(false)
    expect(hostedModeEnabled({ hostedMode: 'true' })).toBe(false) // env leakage is not a yes
  })
})

/**
 * F3 rider (round 3): "hosted has no engine origin" was an operational fact —
 * true only while nobody set NUXT_PUBLIC_COMFY_ORIGIN — and the fallback made
 * it false even unset. Now it is a property of the derivation: hosted returns
 * '', so the client's engine calls stay on the authed same-origin proxy where
 * the tenant gates live.
 */
describe('engineOrigin', () => {
  it('is EMPTY in hosted, whatever the config says', () => {
    expect(engineOrigin({ hostedMode: true })).toBe('')
    expect(engineOrigin({ hostedMode: true, comfyOrigin: 'http://127.0.0.1:8188' })).toBe('')
    expect(engineOrigin({ hostedMode: true, comfyOrigin: 'https://engine.example.com' })).toBe('')
  })

  it('is unchanged in local — configured origin, else the operator @ :8188', () => {
    expect(engineOrigin({})).toBe('http://127.0.0.1:8188')
    expect(engineOrigin({ hostedMode: false })).toBe('http://127.0.0.1:8188')
    expect(engineOrigin({ comfyOrigin: '' })).toBe('http://127.0.0.1:8188')
    expect(engineOrigin({ comfyOrigin: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000')
  })

  it('does not treat a stringy hostedMode as hosted — that would BREAK local', () => {
    // hostedModeEnabled is strict on purpose; engineOrigin inherits it rather
    // than re-deciding, so the two can never disagree about the mode.
    expect(engineOrigin({ hostedMode: 'true', comfyOrigin: 'http://127.0.0.1:9000' })).toBe('http://127.0.0.1:9000')
  })
})
