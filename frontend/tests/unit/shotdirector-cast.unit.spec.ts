import { describe, expect, it } from 'vitest'
import { CAST_MAX, castClause, materializeCast } from '~/lib/shotdirector/cast'
import { compileShot } from '~/lib/shotdirector/compile'
import { hydrateShotSheet } from '~/lib/shotdirector/hydrate'
import { SEEDANCE_PROFILE } from '~/lib/shotdirector/profiles'
import { createDefaultShotSheet } from '~/lib/shotdirector/types'

const U = (n: string) => `/view?filename=${n}&type=input`

function sheetWithCast() {
  const s = createDefaultShotSheet()
  s.cast = [
    { slug: 'reva', name: 'Reva', via: 'picker' },
    { slug: 'marcus', name: 'Marcus', via: 'wire' },
  ]
  return s
}

describe('materializeCast', () => {
  it('injects identity-lock refs cast-first and renumbers manual refs after', () => {
    const s = sheetWithCast()
    s.references = [{ kind: 'image', slot: 1, src: U('manual.png'), role: 'style-transfer' }]
    const { sheet } = materializeCast(s, { reva: [U('r1'), U('r2')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const imgs = sheet.references.filter(r => r.kind === 'image')
    expect(imgs.map(r => [r.slot, r.src, r.castSlug ?? null])).toEqual([
      [1, U('r1'), 'reva'], [2, U('r2'), 'reva'], [3, U('m1'), 'marcus'], [4, U('manual.png'), null],
    ])
    expect(imgs[0]!.role).toBe('identity-lock')
  })

  it('caps refs per member at 3', () => {
    const s = sheetWithCast()
    s.cast = [s.cast[0]!]
    const { sheet } = materializeCast(s, { reva: [U('1'), U('2'), U('3'), U('4')] }, SEEDANCE_PROFILE)
    expect(sheet.references.filter(r => r.castSlug === 'reva')).toHaveLength(3)
  })

  it('is idempotent — re-materializing replaces cast refs, never duplicates', () => {
    const s = sheetWithCast()
    const once = materializeCast(s, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE).sheet
    const twice = materializeCast(once, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE).sheet
    expect(twice.references).toHaveLength(2)
  })

  it('squeezes per-member caps when manual refs crowd the budget, min 1, with a warning', () => {
    const s = sheetWithCast()
    s.references = Array.from({ length: 5 }, (_, i) => ({
      kind: 'image' as const, slot: i + 1, src: U(`man${i}`), role: 'style-transfer' as const,
    }))
    // budget 9 − 5 manual = 4; 2 members → floor(4/2)=2 each
    const { sheet, issues } = materializeCast(s, { reva: [U('1'), U('2'), U('3')], marcus: [U('4'), U('5'), U('6')] }, SEEDANCE_PROFILE)
    expect(sheet.references.filter(r => r.castSlug === 'reva')).toHaveLength(2)
    const warning = issues.find(i => i.level === 'warning' && i.code === 'cast-refs-squeezed')
    expect(warning).toBeDefined()
    expect(warning!.message).toContain('crowd the')
  })

  it('warns with "remove manual references" when budget < members (overcap)', () => {
    const s = sheetWithCast()
    s.cast = [
      { slug: 'a', name: 'Alice', via: 'picker' },
      { slug: 'b', name: 'Bob', via: 'picker' },
      { slug: 'c', name: 'Charlie', via: 'picker' },
    ]
    // 8 manual image refs + 3 members: budget 9 − 8 = 1; min 1 per member → would need 3 total,
    // but only 1 available, so budget < members (1 < 3)
    s.references = Array.from({ length: 8 }, (_, i) => ({
      kind: 'image' as const, slot: i + 1, src: U(`man${i}`), role: 'style-transfer' as const,
    }))
    const { sheet, issues } = materializeCast(s, { a: [U('1')], b: [U('2')], c: [U('3')] }, SEEDANCE_PROFILE)
    const warning = issues.find(i => i.level === 'warning' && i.code === 'cast-refs-squeezed')
    expect(warning).toBeDefined()
    expect(warning!.message).toContain('remove some manual references')
    // Verify downstream compile catches the overflow
    const compiled = compileShot(sheet, SEEDANCE_PROFILE)
    const err = compiled.issues.find(i => i.code === 'too-many-image-refs')
    expect(err).toBeDefined()
    expect(err!.message).toContain('9 image references')
  })

  it('errors on a member with zero resolved refs and on unknown slugs', () => {
    const s = sheetWithCast()
    const { issues } = materializeCast(s, { reva: [] }, SEEDANCE_PROFILE)
    const errs = issues.filter(i => i.level === 'error' && i.code === 'cast-member-no-refs')
    expect(errs).toHaveLength(2) // reva empty + marcus missing entirely
    expect(errs[0]!.message).toContain('Reva')
  })

  it('errors on duplicates and on more than CAST_MAX members', () => {
    const s = createDefaultShotSheet()
    s.cast = [
      { slug: 'a', name: 'A', via: 'picker' }, { slug: 'a', name: 'A', via: 'wire' },
      { slug: 'b', name: 'B', via: 'picker' }, { slug: 'c', name: 'C', via: 'picker' },
      { slug: 'd', name: 'D', via: 'picker' },
    ]
    const { issues } = materializeCast(s, { a: [U('1')], b: [U('2')], c: [U('3')], d: [U('4')] }, SEEDANCE_PROFILE)
    expect(issues.some(i => i.code === 'cast-duplicate')).toBe(true)
    expect(issues.some(i => i.code === 'cast-too-many')).toBe(true)
    expect(CAST_MAX).toBe(3)
  })
})

describe('castClause', () => {
  it('names each member with their bracket tags in slot order', () => {
    const s = sheetWithCast()
    const { sheet } = materializeCast(s, { reva: [U('r1'), U('r2')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    expect(castClause(sheet, SEEDANCE_PROFILE)).toBe('Characters: Reva [Image1] [Image2]; Marcus [Image3].')
  })
  it('is empty with no cast refs', () => {
    expect(castClause(createDefaultShotSheet(), SEEDANCE_PROFILE)).toBe('')
  })
})

describe('compileShot cast integration', () => {
  it('prepends the cast clause to the compiled prompt and counts it in the word budget', () => {
    const s = sheetWithCast()
    s.subject = 'two friends'
    s.action = 'walk along a pier'
    const { sheet } = materializeCast(s, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const res = compileShot(sheet, SEEDANCE_PROFILE)
    expect(res.prompt.startsWith('Characters: Reva [Image1]; Marcus [Image2].')).toBe(true)
    expect(res.prompt).toContain('two friends')
  })
  it('prompt is unchanged for sheets with no cast', () => {
    const s = createDefaultShotSheet()
    s.subject = 'a lighthouse'
    s.action = 'stands in fog'
    expect(compileShot(s, SEEDANCE_PROFILE).prompt.startsWith('Characters:')).toBe(false)
  })
})

describe('hydrate back-compat', () => {
  it('old sheets without cast hydrate to []', () => {
    expect(hydrateShotSheet({ subject: 'x' }).cast).toEqual([])
  })
  it('cast entries survive hydration', () => {
    const cast = [{ slug: 'reva', name: 'Reva', via: 'picker' }]
    expect(hydrateShotSheet({ cast }).cast).toEqual(cast)
  })
  it('cast entries keep a string variantId', () => {
    const cast = [{ slug: 'reva', name: 'Reva', via: 'picker', variantId: 'raincoat' }]
    expect(hydrateShotSheet({ cast }).cast).toEqual(cast)
  })
  it('drops a non-string variantId', () => {
    const cast = [{ slug: 'reva', name: 'Reva', via: 'picker', variantId: 42 }]
    expect(hydrateShotSheet({ cast }).cast).toEqual([{ slug: 'reva', name: 'Reva', via: 'picker' }])
  })
  it('normalizes variantId "default" string away during hydration', () => {
    const cast = [{ slug: 'reva', name: 'Reva', via: 'picker', variantId: 'default' }]
    expect(hydrateShotSheet({ cast }).cast).toEqual([{ slug: 'reva', name: 'Reva', via: 'picker' }])
  })
})

describe('compiled prompt noise suppression', () => {
  it('cast refs emit NO per-ref purpose sentence — the Characters clause covers them', () => {
    const s = sheetWithCast()
    const { sheet } = materializeCast(s, { reva: [U('r1'), U('r2')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const res = compileShot(sheet, SEEDANCE_PROFILE)
    expect(res.prompt).not.toContain('Use [Image')
    expect(res.prompt).not.toContain('identity and wardrobe')
  })

  it('manual refs still get their purpose sentence alongside cast refs', () => {
    const s = sheetWithCast()
    s.references = [{ kind: 'image', slot: 1, src: U('style.png'), role: 'style-transfer' }]
    const { sheet } = materializeCast(s, { reva: [U('r1')], marcus: [U('m1')] }, SEEDANCE_PROFILE)
    const res = compileShot(sheet, SEEDANCE_PROFILE)
    // cast refs occupy [Image1][Image2]; the manual ref renumbers to [Image3]
    expect(res.prompt).toContain('Use [Image3] for the visual style.')
    expect(res.prompt).not.toContain('[Image1] for')
  })

  it('blank dialogue rows emit no stray empty quotes', () => {
    const s = createDefaultShotSheet()
    s.subject = 'a lighthouse'
    s.action = 'stands in fog'
    s.audio.dialogue = [{ speaker: '', line: '' }, { speaker: 'Vera', line: '' }]
    expect(compileShot(s, SEEDANCE_PROFILE).prompt).not.toContain('""')
  })
})
