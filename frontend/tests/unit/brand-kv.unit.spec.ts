import { describe, it, expect } from 'vitest'
import { brandKitToKv } from '../../shared/brand/resolve'

describe('brandKitToKv', () => {
  it('serializes non-empty fields as key=value lines in stable order', () => {
    expect(brandKitToKv({ accent: '#A3E635', primary: '#0a0a0a', fontDisplay: 'Archivo Black' }))
      .toBe('primary=#0a0a0a\naccent=#A3E635\nfontDisplay=Archivo Black')
  })
  it('skips undefined and empty values', () => {
    expect(brandKitToKv({ primary: '', secondary: undefined, accent: '#fff' })).toBe('accent=#fff')
  })
  it('empty kit serializes to the empty string (regression: no kit ⇒ widget untouched)', () => {
    expect(brandKitToKv({})).toBe('')
  })
  it('values containing = survive round-trip-style first-split parsing', () => {
    const kv = brandKitToKv({ logo: '/view?filename=logo.png&type=input' })
    expect(kv).toBe('logo=/view?filename=logo.png&type=input')
    const [k, v] = kv.split('=', 1).concat(kv.slice(kv.indexOf('=') + 1))
    expect(k).toBe('logo')
    expect(v).toBe('/view?filename=logo.png&type=input')
  })
})

describe('brandKitToKv — logo slots', () => {
  it('logo= line carries the effective primary; slots serialize as dotted keys', () => {
    expect(brandKitToKv({
      primary: '#0a0a0a',
      logos: { primary: '/view?filename=p.png&type=input', mark: '/view?filename=m.png&type=input' },
    })).toBe([
      'primary=#0a0a0a',
      'logo=/view?filename=p.png&type=input',
      'logos.primary=/view?filename=p.png&type=input',
      'logos.mark=/view?filename=m.png&type=input',
    ].join('\n'))
  })
  it('legacy logo still emits when no slots exist', () => {
    expect(brandKitToKv({ logo: '/old.png' })).toBe('logo=/old.png')
  })
  it('assets never serialize to KV', () => {
    expect(brandKitToKv({ assets: [{ id: 'a', name: 'x', path: '/x.png' }] })).toBe('')
  })
})
