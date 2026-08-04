import { describe, it, expect } from 'vitest'
import { fontFaceRule, fontFaceId } from '~/lib/embed/fontFace'

const DATA_URL = 'data:font/woff2;base64,AAAA'

describe('fontFaceRule', () => {
  it('produces a well-formed @font-face rule containing the family, weight, and data URI', () => {
    const rule = fontFaceRule({ family: 'Inter', weight: 700, dataUrl: DATA_URL })
    expect(rule).toContain('@font-face')
    expect(rule).toContain("font-family:'Inter'")
    expect(rule).toContain('font-weight:700')
    expect(rule).toContain(`url('${DATA_URL}')`)
  })

  // A family name containing a single quote must not close the quoted CSS
  // string early. If escaping is missing (or wrong), the rule's family value
  // truncates at the embedded quote and the remainder ("s Handwriting) spills
  // out as bare, likely-invalid CSS — this is exactly what a naive
  // implementation that forgets to escape would produce.
  it('escapes a single quote in the family name', () => {
    const rule = fontFaceRule({ family: "Amy's Handwriting", weight: 400, dataUrl: DATA_URL })
    expect(rule).toContain("font-family:'Amy\\'s Handwriting'")
    // The unescaped quote must never appear bare inside the quoted value —
    // that would prematurely terminate the CSS string.
    expect(rule).not.toContain("font-family:'Amy's Handwriting'")
  })

  // A family name containing a literal backslash must itself be escaped
  // (backslash -> double backslash) BEFORE quote-escaping runs. Getting the
  // order wrong (escaping quotes first, backslashes second) would double-escape
  // any quote that follows a backslash. This input has no quote, so it isolates
  // backslash handling on its own.
  it('escapes a backslash in the family name', () => {
    const rule = fontFaceRule({ family: 'Foo\\Bar', weight: 400, dataUrl: DATA_URL })
    expect(rule).toContain("font-family:'Foo\\\\Bar'")
  })

  // Escaping both together, in the same order cssEscape uses (backslash then
  // quote): a naive "escape quotes first" implementation would turn `\'` into
  // `\\'` (escaping the backslash it just introduced), producing a different,
  // wrong result than escaping backslash first.
  it('escapes a family name containing both a backslash and a quote, in the right order', () => {
    const rule = fontFaceRule({ family: "Foo\\Bar's", weight: 400, dataUrl: DATA_URL })
    expect(rule).toContain("font-family:'Foo\\\\Bar\\'s'")
  })

  it('rejects a dataUrl that is not a data: URI', () => {
    expect(() =>
      fontFaceRule({ family: 'Inter', weight: 400, dataUrl: 'https://fonts.example.com/inter.woff2' }),
    ).toThrow(/data:/i)
  })

  it('rejects an empty dataUrl', () => {
    expect(() => fontFaceRule({ family: 'Inter', weight: 400, dataUrl: '' })).toThrow(/data:/i)
  })
})

describe('fontFaceId', () => {
  it('includes the weight so the same family at different weights gets different ids', () => {
    const id400 = fontFaceId('Inter', 400)
    const id700 = fontFaceId('Inter', 700)
    expect(id400).not.toBe(id700)
  })

  it('produces different ids for different families at the same weight', () => {
    expect(fontFaceId('Inter', 400)).not.toBe(fontFaceId('Roboto', 400))
  })

  it('is stable for the same inputs', () => {
    expect(fontFaceId('Inter', 400)).toBe(fontFaceId('Inter', 400))
  })
})
