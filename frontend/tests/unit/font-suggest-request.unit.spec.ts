import { describe, it, expect } from 'vitest'
import { buildSuggestRequest, STANDARD_KEY_ERROR } from '~/lib/fontSuggest'

describe('buildSuggestRequest', () => {
  it('returns an error when the API key is missing', () => {
    const r = buildSuggestRequest(null, 'elegant serif')
    expect(r).toEqual({ ok: false, error: STANDARD_KEY_ERROR })
  })

  it('returns an error when the API key is blank', () => {
    expect(buildSuggestRequest('   ', 'elegant serif')).toEqual({ ok: false, error: STANDARD_KEY_ERROR })
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
})
