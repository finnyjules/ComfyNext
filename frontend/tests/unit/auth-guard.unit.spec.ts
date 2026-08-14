import { describe, it, expect } from 'vitest'
import { guardDecision, PROXY_PREFIXES, PUBLIC_API_PATHS } from '../../server/utils/authGuard'

describe('guardDecision', () => {
  it('local mode passes everything untouched (the deployMode contract)', () => {
    expect(guardDecision('/api/meter/prompt', 'local', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/prompt', 'local', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/anything', 'local', 'user_1')).toEqual({ kind: 'pass' })
  })

  it('hosted mode rejects unauthenticated guarded paths', () => {
    expect(guardDecision('/api/meter/prompt', 'hosted', null)).toEqual({ kind: 'reject' })
    expect(guardDecision('/prompt', 'hosted', null)).toEqual({ kind: 'reject' })   // proxied engine path
    expect(guardDecision('/view?filename=x.png', 'hosted', null)).toEqual({ kind: 'reject' })
    expect(guardDecision('/api', 'hosted', null)).toEqual({ kind: 'reject' })      // bare prefix counts
  })

  it('hosted mode attaches the user on guarded paths', () => {
    expect(guardDecision('/api/wallet', 'hosted', 'user_1')).toEqual({ kind: 'attach', userId: 'user_1' })
    expect(guardDecision('/queue', 'hosted', 'user_1')).toEqual({ kind: 'attach', userId: 'user_1' })
  })

  it('hosted mode passes public API paths and non-guarded paths', () => {
    expect(guardDecision('/api/webhooks/clerk', 'hosted', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/', 'hosted', null)).toEqual({ kind: 'pass' })            // app page
    expect(guardDecision('/sign-in', 'hosted', null)).toEqual({ kind: 'pass' })     // Clerk pages
    expect(guardDecision('/_nuxt/foo.js', 'hosted', null)).toEqual({ kind: 'pass' })
  })

  it('prefix matching is boundary-aware, not raw startsWith', () => {
    // '/apiFOO' must NOT match the '/api' prefix; '/promptly' must not match '/prompt'
    expect(guardDecision('/apiFOO', 'hosted', null)).toEqual({ kind: 'pass' })
    expect(guardDecision('/promptly', 'hosted', null)).toEqual({ kind: 'pass' })
  })

  it('exports the proxy prefix list for the proxy middleware to share', () => {
    expect(PROXY_PREFIXES).toContain('/api')
    expect(PROXY_PREFIXES).toContain('/prompt')
    expect(PUBLIC_API_PATHS).toContain('/api/webhooks/clerk')
    expect(PUBLIC_API_PATHS).toContain('/api/webhooks/stripe')
  })
})
