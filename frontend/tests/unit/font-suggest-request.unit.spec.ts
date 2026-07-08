import { describe, it, expect } from 'vitest'
import { buildSuggestRequest } from '~/lib/fontSuggest'

describe('buildSuggestRequest', () => {
  it('sends no apiKey field when no local key is set (server key applies)', () => {
    const r = buildSuggestRequest(null, 'elegant serif')
    expect(r).toEqual({ ok: true, body: { query: 'elegant serif' } })
  })

  it('sends no apiKey field when the local key is blank', () => {
    expect(buildSuggestRequest('   ', 'elegant serif')).toEqual({ ok: true, body: { query: 'elegant serif' } })
  })

  it('returns ok:false with no error for a blank query (nothing to do)', () => {
    const r = buildSuggestRequest('sk-key', '   ')
    expect(r.ok).toBe(false)
    expect((r as any).error).toBeUndefined()
  })

  it('builds a trimmed request body when key and query are present', () => {
    const r = buildSuggestRequest('sk-key', '  knicks logo  ')
    expect(r).toEqual({ ok: true, body: { apiKey: 'sk-key', query: 'knicks logo' } })
  })

  it('rides a local key along as a BYOK override', () => {
    expect(buildSuggestRequest('sk-key', 'q')).toEqual({ ok: true, body: { apiKey: 'sk-key', query: 'q' } })
  })
})
