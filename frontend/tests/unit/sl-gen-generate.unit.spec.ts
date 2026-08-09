import { describe, it, expect } from 'vitest'
import { generate, shuffle, surprise, migrateGen } from '~~/shared/template-grid/generate/generate'
import { validateGenerated } from '~~/shared/template-grid/generate/validate'
import { getStaging, STAGINGS } from '~~/shared/template-grid/generate/stagings'
import { makeRng } from '~~/shared/template-grid/generate/rng'
import { THEMES, resolveInk } from '~~/shared/template-grid/generate/themes'
import type { TemplateV3, ElementV2 } from '~~/shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 'T', master: '3x4',
    formats: { '3x4': { w: 1080, h: 1440 } },
    grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
    typeScale: { base: 14, ratio: 1.5 },
    background: {},
    elements: [],
    sections: [],
    tiers: {
      hero: { content: 'MAT + FEST' },
      anchor: { content: '15—26 June' },
      support: { content: 'Street food' },
      fineprint: { content: 'Slakthus' },
    },
  }
}

describe('generate orchestrator — themes', () => {
  // (a) fresh generate stamps brand from the theme, tokenizes ink + background
  it('(a) fresh generate stamps brand.background/foreground from the theme and tokenizes ink + background', () => {
    const t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    expect(t.brand?.background).toBe('#f2f0ef')
    expect(t.brand?.foreground).toBe('#111111')
    const hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero.style.color).toBe('{{ brand.foreground }}')
    expect(t.background?.fill).toBe('{{ brand.background }}')
    expect(t.gen).toMatchObject({ staging: 'tower', theme: 'paper', seed: 1 })
  })

  // (b) same-theme regen never rewrites a hand edit; a theme switch re-stamps
  it('(b) same-theme regeneration preserves a hand-edited brand; switching theme re-stamps', () => {
    const t0 = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const edited: TemplateV3 = { ...t0, brand: { ...t0.brand, background: '#ff00aa' } }
    const same = generate(edited, { staging: 'tower', theme: 'paper', seed: 2 })
    expect(same.brand?.background).toBe('#ff00aa')

    const switched = generate(edited, { staging: 'tower', theme: 'black', seed: 3 })
    expect(switched.brand?.background).toBe('#000000')
    expect(switched.brand?.foreground).toBe('#f2f0ef')
  })

  // (c) legacy `surface` gen migrates through shuffle without erroring
  it('(c) legacy gen.surface shuffles without error and lands on theme paper', () => {
    const t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const legacy = { ...t, gen: { staging: 'tower', surface: 'flat', seed: 1 } as any }
    const rolled = shuffle(legacy)
    expect(rolled.gen?.theme).toBe('paper')
  })

  it('(c2) migrateGen maps every round-1 surface id to its theme', () => {
    expect(migrateGen({ staging: 'tower', surface: 'tint', seed: 1 } as any)?.theme).toBe('red')
    expect(migrateGen({ staging: 'tower', surface: 'split-field', seed: 1 } as any)?.theme).toBe('black')
    expect(migrateGen(undefined)).toBeUndefined()
    expect(migrateGen({ staging: 'tower', theme: 'blue', seed: 1 })).toEqual({ staging: 'tower', theme: 'blue', seed: 1 })
  })

  // (c-migrations, round-2b Task 5) retired staging ids migrate at the same
  // choke point as surface->theme — a stored gen naming `editorial`,
  // `centered`, or `ledger` (the temp id `index`'s ruled-table rebuild
  // shipped under, per Task 2's naming-collision workaround) resolves to a
  // live registry id instead of `getStaging` failing to find it.
  it('(c-mig-1) migrateGen maps unconditional retirements forward: editorial -> stacked, ledger -> index', () => {
    expect(migrateGen({ staging: 'editorial', theme: 'paper', seed: 1 })?.staging).toBe('stacked')
    expect(migrateGen({ staging: 'ledger', theme: 'paper', seed: 1 })?.staging).toBe('index')
    expect(migrateGen({ staging: 'tower', theme: 'paper', seed: 1 })?.staging).toBe('tower') // untouched
  })
  it('(c-mig-2) migrateGen maps centered by CURRENT image presence: withImage -> lockup, without -> stacked', () => {
    expect(migrateGen({ staging: 'centered', theme: 'paper', seed: 1 }, { hasImage: true })?.staging).toBe('lockup')
    expect(migrateGen({ staging: 'centered', theme: 'paper', seed: 1 }, { hasImage: false })?.staging).toBe('stacked')
    expect(migrateGen({ staging: 'centered', theme: 'paper', seed: 1 })?.staging).toBe('stacked') // default: no image
  })
  it('(c-mig-3) a stored gen naming a retired staging shuffles cleanly, without throwing, onto its mapped id', () => {
    const legacyEditorial: TemplateV3 = { ...base(), gen: { staging: 'editorial', theme: 'paper', seed: 1 } }
    expect(() => shuffle(legacyEditorial)).not.toThrow()
    expect(shuffle(legacyEditorial).gen?.staging).toBe('stacked')

    const legacyLedger: TemplateV3 = { ...base(), gen: { staging: 'ledger', theme: 'paper', seed: 1 } }
    expect(shuffle(legacyLedger).gen?.staging).toBe('index')

    const legacyCentered: TemplateV3 = { ...base(), gen: { staging: 'centered', theme: 'paper', seed: 1 } }
    expect(shuffle(legacyCentered).gen?.staging).toBe('stacked') // no image wired at this call
    expect(shuffle(legacyCentered, { image: '{{ props.image_layer_1 }}' }).gen?.staging).toBe('lockup')
  })
  // (c-mig-modal, round-2b Task 5 fix) SmartLayoutEditorModal.vue's onMounted
  // migrates `v3.gen` on open using the SAME presence-object call form the
  // modal now uses (`migrateGen(v3.gen, { hasImage })`, hoisted from the
  // `'image_layer_1' in initialProps.value` check computed later in the same
  // function). This mirrors the modal's exact call shape so a legacy stored
  // `gen.staging: 'centered'` doc reopened WITH a wired image resolves to
  // `lockup`, not `stacked` — the bug was calling `migrateGen(v3.gen)` with no
  // context at all, which silently defaulted to `hasImage: false`.
  it('(c-mig-modal) modal reopen call form: migrateGen(v3.gen, { hasImage }) resolves centered+image -> lockup', () => {
    const initialProps: Record<string, string> = { image_layer_1: 'https://example.com/photo.png' }
    const hasImage = 'image_layer_1' in initialProps
    const storedGen = { staging: 'centered', theme: 'paper', seed: 1 } as any
    expect(migrateGen(storedGen, { hasImage })?.staging).toBe('lockup')

    const noImageProps: Record<string, string> = {}
    const hasImage2 = 'image_layer_1' in noImageProps
    expect(migrateGen(storedGen, { hasImage: hasImage2 })?.staging).toBe('stacked')
  })
  it('(c-mig-4) STAGINGS registry is exactly the 14 sorted ids (round-2b final registry)', () => {
    expect(STAGINGS.map(s => s.id).sort()).toEqual([
      'band_footer', 'band_header', 'corner', 'cover', 'frame', 'index',
      'lockup', 'manifesto', 'repeat', 'split', 'stacked', 'statement',
      'tower', 'wall',
    ])
  })

  // (c3) legacy `locks.surface` renames to `locks.theme` (and stays honoured)
  it('(c3) migrateGen renames locks.surface to locks.theme so a legacy lock survives surprise()', () => {
    const t: TemplateV3 = {
      ...base(),
      gen: { staging: 'tower', surface: 'tint', seed: 1, locks: { surface: true } } as any,
    }
    const rolled = surprise(t)
    expect(rolled.gen?.theme).toBe('red')
    expect(rolled.gen?.locks).toEqual({ theme: true })

    // idempotent: a doc already on `locks.theme` is untouched
    const already = migrateGen({ staging: 'tower', theme: 'blue', seed: 1, locks: { theme: true } })
    expect(already?.locks).toEqual({ theme: true })
  })

  // (d) accentOnHero only touches tier_hero_0
  it('(d) accentOnHero colours only tier_hero_0 with the accent token', () => {
    const t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1, accentOnHero: true })
    const hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    const anchor = t.elements.find(e => e.id === 'tier_anchor_0') as any
    expect(hero.style.color).toBe('{{ brand.accent }}')
    expect(anchor.style.color).toBe('{{ brand.foreground }}')
  })

  // (e) luminance guard: a clashing opts.brand kit gets a literal ink injected
  it('(e) luminance guard injects a literal ink when the effective brand clashes', () => {
    const t = generate(base(), { staging: 'tower', theme: 'white', seed: 1, brand: { foreground: '#ffffff' } })
    const hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero.style.color).toBe('#111111')
  })

  // (f) a tier's own type.color always wins
  it('(f) tier type.color beats the theme ink and the guard', () => {
    const withColor: TemplateV3 = { ...base(), tiers: { ...base().tiers, hero: { content: 'MAT + FEST', type: { color: '#ff0000' } } } }
    const t = generate(withColor, { staging: 'tower', theme: 'paper', seed: 1 })
    const hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero.style.color).toBe('#ff0000')

    const guardTripped = generate(withColor, { staging: 'tower', theme: 'white', seed: 1, brand: { foreground: '#ffffff' } })
    const heroGuard = guardTripped.elements.find(e => e.id === 'tier_hero_0') as any
    expect(heroGuard.style.color).toBe('#ff0000')
  })

  // (g) determinism
  it('(g) is deterministic for the same tuple', () => {
    const a = generate(base(), { staging: 'split', theme: 'paper', seed: 7 })
    const b = generate(base(), { staging: 'split', theme: 'paper', seed: 7 })
    expect(JSON.stringify(a.elements)).toBe(JSON.stringify(b.elements))
    expect(JSON.stringify(a.brand)).toBe(JSON.stringify(b.brand))
  })

  it('preserves freeform elements across a re-roll', () => {
    let t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const freeform: ElementV2 = { id: 'note', type: 'text', content: 'hand-added', level: 'body',
      priority: 9, region: { col: 1, colSpan: 3, row: 14, rowSpan: 1 }, origin: 'freeform' }
    t = { ...t, elements: [...t.elements, freeform] }
    const rolled = shuffle(t)
    expect(rolled.elements.find(e => e.id === 'note')?.origin).toBe('freeform')
  })

  it('tier type overrides survive a re-roll', () => {
    const t0 = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const withType: TemplateV3 = { ...t0, tiers: { ...t0.tiers, hero: { content: 'MAT + FEST', type: { letterSpacing: -3 } } } }
    const rolled = surprise(withType)
    const hero = rolled.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero.style.letterSpacing).toBe(-3)
  })

  it('shuffle keeps a locked staging but may change the seed', () => {
    const t = generate(base(), { staging: 'frame', theme: 'paper', seed: 1 })
    const locked: TemplateV3 = { ...t, gen: { ...t.gen!, locks: { staging: true } } }
    const rolled = shuffle(locked)
    expect(rolled.gen?.staging).toBe('frame')
  })

  it('shuffle keeps {staging, theme}, only the seed (and re-stamped elements) change', () => {
    const t = generate(base(), { staging: 'frame', theme: 'blue', seed: 1 })
    const rolled = shuffle(t)
    expect(rolled.gen?.staging).toBe('frame')
    expect(rolled.gen?.theme).toBe('blue')
    expect(rolled.gen?.seed).not.toBe(1)
  })

  it('surprise re-rolls both axes from all 6 stagings × all 7 themes, honouring locks', () => {
    const t = generate(base(), { staging: 'frame', theme: 'blue', seed: 1 })
    const lockedTheme: TemplateV3 = { ...t, gen: { ...t.gen!, locks: { theme: true } } }
    const rolled = surprise(lockedTheme)
    expect(rolled.gen?.theme).toBe('blue')
    expect(STAGINGS.map(s => s.id)).toContain(rolled.gen?.staging)
    expect(THEMES.map(th => th.id)).toContain(rolled.gen?.theme)
  })

  it('writes template.order as staged ids (compose order) then preserved ids', () => {
    let t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const freeform: ElementV2 = { id: 'note', type: 'text', content: 'hand-added', level: 'body',
      priority: 9, region: { col: 1, colSpan: 3, row: 14, rowSpan: 1 }, origin: 'freeform' }
    t = { ...t, elements: [...t.elements, freeform] }
    const rolled = shuffle(t)
    const stagedIds = rolled.elements.filter(e => e.origin === 'staging').map(e => e.id)
    const preservedIds = rolled.elements.filter(e => e.origin !== 'staging').map(e => e.id)
    expect(rolled.order).toEqual([...stagedIds, ...preservedIds])
    expect(rolled.order?.slice(0, stagedIds.length)).toEqual(stagedIds)
    expect(rolled.order).toContain('note')
  })

  // -- Round-2a final-fix wave --------------------------------------------

  // FIX 1: relLuminance is total (never throws) — generate() must survive a
  // malformed/free-text effective brand value instead of crashing.
  it('FIX 1: does not throw when opts.brand carries a malformed/non-hex colour', () => {
    expect(() => generate(base(), { staging: 'tower', theme: 'paper', seed: 1, brand: { background: '#ff00aaff' } })).not.toThrow()
    expect(() => generate(base(), { staging: 'tower', theme: 'paper', seed: 1, brand: { foreground: 'rgb(0,0,0)' } })).not.toThrow()
    expect(() => generate(base(), { staging: 'tower', theme: 'paper', seed: 1, brand: { background: '#11' } })).not.toThrow()
  })

  it('FIX 1: an #rrggbbaa effective brand value is treated as its #rrggbb (no spurious guard trip)', () => {
    // white-on-white theme clash normally trips the guard (see test (e));
    // an alpha-suffixed WHITE foreground should behave identically to '#ffffff'.
    const withAlpha = generate(base(), { staging: 'tower', theme: 'white', seed: 1, brand: { foreground: '#ffffffff' } })
    const withoutAlpha = generate(base(), { staging: 'tower', theme: 'white', seed: 1, brand: { foreground: '#ffffff' } })
    const heroA = withAlpha.elements.find(e => e.id === 'tier_hero_0') as any
    const heroB = withoutAlpha.elements.find(e => e.id === 'tier_hero_0') as any
    expect(heroA.style.color).toBe(heroB.style.color)
    expect(heroA.style.color).toBe('#111111')   // guard tripped in both cases
  })

  // FIX 2: missing-key backfill fills ONLY the missing key(s), not all three.
  it('FIX 2: same-theme regen with one brand key cleared backfills ONLY that key', () => {
    const t0 = generate(base(), { staging: 'tower', theme: 'blue', seed: 1 })
    expect(t0.brand?.background).toBe('#1d4ed8')
    const handEdited = { ...t0.brand, background: '#ff00aa', accent: '#00ffcc' }
    const { foreground: _drop, ...clearedForeground } = handEdited
    const withGap: TemplateV3 = { ...t0, brand: clearedForeground as any }
    const restamped = generate(withGap, { staging: 'tower', theme: 'blue', seed: 2 })
    // The missing key is backfilled from the theme...
    expect(restamped.brand?.foreground).toBe(resolveInk('#1d4ed8'))
    // ...but the two PRESENT hand-edited keys survive untouched.
    expect(restamped.brand?.background).toBe('#ff00aa')
    expect(restamped.brand?.accent).toBe('#00ffcc')
  })

  // FIX 3: brandEdits pins a key across every stamping trigger, including a
  // theme change picked up mid-Surprise; an explicit setTheme (not exercised
  // here — that's the composable's job, see sl-gen-editor-actions) is the
  // only thing that's supposed to clear it.
  it('FIX 3: a key listed in gen.brandEdits survives a theme change inside generate()', () => {
    const t0 = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const pinned: TemplateV3 = {
      ...t0, brand: { ...t0.brand, background: '#ff00aa' },
      gen: { ...t0.gen!, brandEdits: ['background'] },
    }
    const switched = generate(pinned, { staging: 'tower', theme: 'black', seed: 2 })
    expect(switched.brand?.background).toBe('#ff00aa')   // pinned — theme change didn't touch it
    expect(switched.brand?.foreground).toBe('#f2f0ef')   // unpinned key DID re-stamp
    expect(switched.gen?.brandEdits).toEqual(['background'])   // carried through
  })

  it('FIX 3: an unpinned brand persists across a theme change exactly as before (no regression)', () => {
    const t0 = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const edited: TemplateV3 = { ...t0, brand: { ...t0.brand, background: '#ff00aa' } }
    const switched = generate(edited, { staging: 'tower', theme: 'black', seed: 2 })
    expect(switched.brand?.background).toBe('#000000')   // no brandEdits pin -> normal re-stamp
  })

  // FIX 4: a hand-arranged z-order (freeform sent to back) survives a re-roll
  // instead of jumping back to the front on every regeneration.
  it('FIX 4: a freeform element moved to the FRONT of order stays there across shuffle', () => {
    let t = generate(base(), { staging: 'tower', theme: 'paper', seed: 1 })
    const freeform: ElementV2 = { id: 'note', type: 'text', content: 'hand-added', level: 'body',
      priority: 9, region: { col: 1, colSpan: 3, row: 14, rowSpan: 1 }, origin: 'freeform' }
    t = { ...t, elements: [...t.elements, freeform] }
    // Simulate "sent to back" (order[0] = back of z-order) — 'note' first.
    const stagedIds = t.elements.filter(e => e.origin === 'staging').map(e => e.id)
    t = { ...t, order: ['note', ...stagedIds] }
    const rolled = shuffle(t)
    expect(rolled.order?.[0]).toBe('note')
  })

  it('generates a validator-clean result for the standard 4-tier fixture (no unvalidated ship on exhausted re-rolls)', () => {
    const standard: TemplateV3 = {
      ...base(),
      tiers: {
        hero: { content: 'MAT + FEST' },
        anchor: { content: '15—26 June' },
        support: [{ content: 'Street food · Dining' }, { content: 'Live music · Market' }],
        fineprint: [{ content: 'Slakthus · Hall 3' }, { content: 'Free entry · All ages' }],
      },
    }
    // Reconstructing `{ elements: staged }` from the generated TEMPLATE loses
    // any `overlaps` the staging declared — `ElementV2` carries no such
    // field, only `StagingResult` does, and that's transient inside
    // `generate()`. That was harmless while every declared overlap was
    // image-gated (no `image` is threaded in this test, so those stagings
    // always declared zero) — Family C's `band_header`/`band_footer`
    // (round-2b Task 4) break the assumption: `band_0` renders regardless of
    // photo, so their hero/anchor/(fineprint|support) overlaps stay declared
    // with or without one. Recomposing directly via the staging (same
    // tiers/cols/rows/canvas, and the EXACT knobs `generate()` resolved,
    // read back off `t.gen.knobs`) reproduces what `generate()`'s own
    // internal retry loop actually validated, overlaps included — still
    // proving the real invariant (never ships an unvalidated result).
    for (const s of STAGINGS) {
      const t = generate(standard, { staging: s.id, theme: 'paper', seed: 1 })
      const cols = t.grid.columns ?? 12
      const rows = t.grid.rows ?? 16
      const masterFormat = t.formats[t.master]!
      const canvas = { w: masterFormat.w, h: masterFormat.h }
      const result = getStaging(s.id)!.compose({
        tiers: standard.tiers ?? {}, cols, rows, canvas,
        rng: makeRng(1, 'staging'), knobs: t.gen?.knobs ?? {},
      })
      const { ok, reasons } = validateGenerated(result, cols, rows)
      expect(ok, `${s.id}: ${reasons.join(' ')}`).toBe(true)
    }
  })
})
