import { describe, it, expect } from 'vitest'
import { buildEmbedHtml, EXTERNAL_REF_PATTERN } from '~/lib/embed/bundle'
import type { EmbedSnapshot } from '~/lib/embed/contract'

const POSTER = 'data:image/png;base64,iVBORw0KGgo='

function snap(over: Partial<EmbedSnapshot> = {}): EmbedSnapshot {
  return {
    kind: 'shader',
    config: { effects: [{ effectId: 'aurora', source: '// glsl', params: { u_amount: 0.5 }, seed: 42, passes: 1 }] },
    duration: 30,
    width: 800,
    height: 450,
    posterDataUrl: POSTER,
    transparent: false,
    ...over,
  }
}

describe('buildEmbedHtml', () => {
  it('inlines the adapter javascript', () => {
    const html = buildEmbedHtml(snap(), 'globalThis.__SAILOR_SURFACE__ = {};')
    expect(html).toContain('globalThis.__SAILOR_SURFACE__')
  })

  it('inlines the config and the poster', () => {
    const html = buildEmbedHtml(snap(), '')
    expect(html).toContain('aurora')
    expect(html).toContain(POSTER)
  })

  it('contains no external references', () => {
    const html = buildEmbedHtml(snap(), 'const x = 1;')
    expect(html.match(EXTERNAL_REF_PATTERN)).toBeNull()
  })

  it('escapes a closing script tag hidden in the config', () => {
    const html = buildEmbedHtml(
      snap({ config: { effects: [{ effectId: '</script><img src=x>', source: '', params: {}, seed: 1, passes: 1 }] } }),
      '',
    )
    expect(html).not.toContain('</script><img')
  })

  it('rejects a non-positive duration', () => {
    expect(() => buildEmbedHtml(snap({ duration: 0 }), '')).toThrow(/duration/i)
  })

  it('rejects a poster that is not a data URI', () => {
    expect(() => buildEmbedHtml(snap({ posterDataUrl: 'https://example.com/p.png' }), '')).toThrow(/data:/i)
  })
})
