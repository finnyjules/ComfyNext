import { describe, it, expect } from 'vitest'
import { useGridEditor } from '~/composables/useGridEditor'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import type { TemplateV3 } from '~~/shared/template-grid/types'

function editorWithTiers() {
  const ctx = useGridEditor(makeStarterTemplate('gen-test'))
  ctx.convertToV3()
  ;(ctx.template.value as TemplateV3).tiers = {
    hero: { content: 'MAT + FEST' }, anchor: { content: '15—26' },
    support: { content: 'Food' }, fineprint: { content: 'Hall 3' },
  }
  return ctx
}

describe('useGridEditor generation actions', () => {
  it('surprise fills the canvas with staging elements and stamps gen', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    expect(t.elements.some(e => e.origin === 'staging')).toBe(true)
    expect(t.gen?.staging).toBeTruthy()
  })
  it('setTheme holds the staging (axis independence)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    ctx.setTheme('red')
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.theme).toBe('red')
  })
  it('shuffle is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const before = JSON.stringify((ctx.template.value as TemplateV3).elements)
    ctx.shuffleLayout()
    ctx.undo()
    expect(JSON.stringify((ctx.template.value as TemplateV3).elements)).toBe(before)
  })
  it('addTierItem adds a hero-tier text element', () => {
    const ctx = useGridEditor(makeStarterTemplate('add-test'))
    ctx.convertToV3()
    ctx.addTierItem('hero', 'BIG NEWS')
    const t = ctx.template.value as TemplateV3
    expect(t.tiers?.hero?.[0]?.content).toBe('BIG NEWS')
  })
  it('surpriseLayout marks the doc dirty', () => {
    const ctx = editorWithTiers()
    ctx.dirty.value = false // reset past setup's own dirty-setting (convertToV3)
    ctx.surpriseLayout()
    expect(ctx.dirty.value).toBe(true)
  })
  it('shuffleLayout marks the doc dirty', () => {
    const ctx = editorWithTiers()
    ctx.dirty.value = false // reset past setup's own dirty-setting (convertToV3)
    ctx.shuffleLayout()
    expect(ctx.dirty.value).toBe(true)
  })
  it('setStaging preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setStaging('frame')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('setTheme preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setTheme('blue')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('setTierType preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.setTierType('anchor', { letterSpacing: -1 })
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })
  it('addTierItem preserves accentOnHero on regeneration', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const t = ctx.template.value as TemplateV3
    t.gen = { ...t.gen!, accentOnHero: true }
    ctx.addTierItem('support', 'More food')
    const t2 = ctx.template.value as TemplateV3
    const hero = t2.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(t2.gen?.accentOnHero).toBe(true)
  })

  // -- Round-2a Task 8: theme actions + true-append tiers --------------------

  it('addTierItem APPENDS — two calls stage both items (round-1 overwrite regression)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const idx0 = ctx.addTierItem('support', 'A')
    const idx1 = ctx.addTierItem('support', 'B')
    expect(idx0).toBe(1)   // 'support' already has one seeded item ('Food') from editorWithTiers
    expect(idx1).toBe(2)
    const t = ctx.template.value as TemplateV3
    const support = t.tiers?.support
    const items = Array.isArray(support) ? support : support ? [support] : []
    expect(items.map(i => i.content)).toEqual(['Food', 'A', 'B'])
    const els = t.elements.filter(e => e.id?.startsWith('tier_support_'))
    const byId = Object.fromEntries(els.map(e => [e.id, (e as any).content]))
    expect(byId.tier_support_0).toBe('Food')
    expect(byId.tier_support_1).toBe('A')
    expect(byId.tier_support_2).toBe('B')
  })

  it('addTierItem on a fresh tier appends starting at index 0', () => {
    const ctx = useGridEditor(makeStarterTemplate('append-fresh'))
    ctx.convertToV3()
    const idx0 = ctx.addTierItem('support', 'A')
    const idx1 = ctx.addTierItem('support', 'B')
    expect(idx0).toBe(0)
    expect(idx1).toBe(1)
    const t = ctx.template.value as TemplateV3
    const els = t.elements.filter(e => e.id?.startsWith('tier_support_'))
    const byId = Object.fromEntries(els.map(e => [e.id, (e as any).content]))
    expect(byId.tier_support_0).toBe('A')
    expect(byId.tier_support_1).toBe('B')
  })

  it('addTierItem defaults content to the capitalized tier id when omitted', () => {
    const ctx = useGridEditor(makeStarterTemplate('append-default'))
    ctx.convertToV3()
    ctx.addTierItem('support')
    const t = ctx.template.value as TemplateV3
    const support = t.tiers?.support
    const items = Array.isArray(support) ? support : support ? [support] : []
    expect(items[0]?.content).toBe('SUPPORT')
  })

  it('toggleAccentOnHero flips hero to accent, then back to the foreground token', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    expect(ctx.genAccentOnHero.value).toBe(false)
    ctx.toggleAccentOnHero()
    let t = ctx.template.value as TemplateV3
    let hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.accent }}')
    expect(ctx.genAccentOnHero.value).toBe(true)
    ctx.toggleAccentOnHero()
    t = ctx.template.value as TemplateV3
    hero = t.elements.find(e => e.id === 'tier_hero_0') as any
    expect(hero?.style?.color).toBe('{{ brand.foreground }}')
    expect(ctx.genAccentOnHero.value).toBe(false)
  })

  it('toggleAccentOnHero holds the same staging/theme tuple', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const staging = (ctx.template.value as TemplateV3).gen!.staging
    const theme = (ctx.template.value as TemplateV3).gen!.theme
    ctx.toggleAccentOnHero()
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.staging).toBe(staging)
    expect(t.gen?.theme).toBe(theme)
  })

  // MINOR #11+14 (round-2b final fix wave): `currentGenOpts`'s
  // `migrateStaging` call is defence-in-depth — a doc whose `gen.staging`
  // still names a retired id (`ledger`, pre-round-2b-Task-5's rename to
  // `index`) must regenerate under the MAPPED id when any in-place action
  // (not just a fresh open, which goes through `migrateGen`) re-triggers
  // `generate()`, rather than crashing or silently falling through to
  // `STAGINGS[0]` because `getStaging('ledger')` finds nothing.
  it('toggleAccentOnHero migrates a stored retired staging id forward (defence-in-depth)', () => {
    const ctx = editorWithTiers()
    const t = ctx.template.value as TemplateV3
    t.gen = { staging: 'ledger', theme: 'paper', seed: 1 }
    ctx.toggleAccentOnHero()
    const after = ctx.template.value as TemplateV3
    expect(after.gen?.staging).toBe('index')
  })

  it('toggleAccentOnHero is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    expect(ctx.genAccentOnHero.value).toBe(false)
    ctx.toggleAccentOnHero()
    expect(ctx.genAccentOnHero.value).toBe(true)
    ctx.undo()
    expect(ctx.genAccentOnHero.value).toBe(false)
  })

  it('setBrandOverride writes template.brand and survives shuffleLayout', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    let t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#ff00aa')
    ctx.shuffleLayout()
    t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#ff00aa')
  })

  it('setBrandOverride(null) restores the current theme\'s stamped value', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setTheme('blue')
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).brand?.background).toBe('#ff00aa')
    ctx.setBrandOverride('background', null)
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#1d4ed8')   // theme 'blue' field
  })

  it('setBrandOverride is undoable', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    const before = (ctx.template.value as TemplateV3).brand?.background
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).brand?.background).toBe('#ff00aa')
    ctx.undo()
    expect((ctx.template.value as TemplateV3).brand?.background).toBe(before)
  })

  it('setBrandOverride on a cold-start template (no prior generate) is not discarded by the stamp guard', () => {
    const ctx = useGridEditor(makeStarterTemplate('cold-start-brand'))
    ctx.convertToV3()
    // No surpriseLayout/setTheme/etc. before this — `gen` doesn't exist yet.
    ctx.setBrandOverride('accent', '#123456')
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.accent).toBe('#123456')
    ctx.shuffleLayout()
    const t2 = ctx.template.value as TemplateV3
    expect(t2.brand?.accent).toBe('#123456')
  })

  // -- Round-2a final-fix 3: brandEdits PIN hand-edited keys across rolls -----

  it('FIX 3: setBrandOverride pins the key — it survives repeated Surprise rolls even once the theme itself changes', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).gen?.brandEdits).toEqual(['background'])
    const startTheme = (ctx.template.value as TemplateV3).gen?.theme
    let themeChanged = false
    for (let i = 0; i < 40 && !themeChanged; i++) {
      ctx.surpriseLayout()   // theme axis unlocked by default — free to re-roll
      if ((ctx.template.value as TemplateV3).gen?.theme !== startTheme) themeChanged = true
    }
    expect(themeChanged).toBe(true)   // sanity: this run actually exercised a theme change
    expect((ctx.template.value as TemplateV3).brand?.background).toBe('#ff00aa')
  })

  it('FIX 3: an explicit setTheme clears brandEdits and re-stamps the previously-pinned key', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).gen?.brandEdits).toContain('background')
    ctx.setTheme('green')
    const t = ctx.template.value as TemplateV3
    expect(t.gen?.brandEdits ?? []).not.toContain('background')
    expect(t.brand?.background).toBe('#2e6f40')   // theme 'green' field — re-stamped, no longer pinned
  })

  it('FIX 3: setBrandOverride(key, null) restores AND un-pins the key', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    expect((ctx.template.value as TemplateV3).gen?.brandEdits).toContain('background')
    ctx.setBrandOverride('background', null)
    expect((ctx.template.value as TemplateV3).gen?.brandEdits ?? []).not.toContain('background')
  })

  it('FIX 2 (composable): clearing one brand key via setBrand backfills ONLY that key, not the other two', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrandOverride('background', '#ff00aa')
    ctx.setBrandOverride('accent', '#00ffcc')
    ctx.setBrand({ background: '' })   // clear via the generic brand patch (empty string = clear)
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBeTruthy()       // backfilled from the theme, not left blank
    expect(t.brand?.background).not.toBe('#ff00aa')
    expect(t.brand?.accent).toBe('#00ffcc')         // untouched
  })

  it('minor: setBrand touching an axis key regenerates + pins brandEdits (parity with setBrandOverride)', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setBrand({ background: '#123123' })
    const t = ctx.template.value as TemplateV3
    expect(t.brand?.background).toBe('#123123')
    expect(t.gen?.brandEdits).toContain('background')
  })

  // -- Round-2a final-fix 7: setTierType/tierType address a SPECIFIC item ----

  it('setTierType(id, patch, index) patches ONLY that item — item 0 untouched, survives a re-roll', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.addTierItem('support', 'Second line')   // support now: 0='Food', 1='Second line'
    ctx.setTierType('support', { letterSpacing: -2 }, 1)

    let t = ctx.template.value as TemplateV3
    const support = t.tiers?.support
    const items = Array.isArray(support) ? support : support ? [support] : []
    expect(items[0]?.type?.letterSpacing).toBeUndefined()
    expect(items[1]?.type?.letterSpacing).toBe(-2)

    const el0 = t.elements.find(e => e.id === 'tier_support_0') as any
    const el1 = t.elements.find(e => e.id === 'tier_support_1') as any
    expect(el0?.style?.letterSpacing).toBeUndefined()
    expect(el1?.style?.letterSpacing).toBe(-2)

    ctx.shuffleLayout()
    t = ctx.template.value as TemplateV3
    const support2 = t.tiers?.support
    const items2 = Array.isArray(support2) ? support2 : support2 ? [support2] : []
    expect(items2[1]?.type?.letterSpacing).toBe(-2)
    expect(items2[0]?.type?.letterSpacing).toBeUndefined()
  })

  it('tierType(id, index) reads the addressed item, not always item 0', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.addTierItem('support', 'Second line')
    ctx.setTierType('support', { letterSpacing: -2 }, 1)
    expect(ctx.tierType('support', 1).letterSpacing).toBe(-2)
    expect(ctx.tierType('support', 0).letterSpacing).toBeUndefined()
    expect(ctx.tierType('support').letterSpacing).toBeUndefined()   // default index 0, unchanged behaviour
  })

  it('setTierType with the default index (0) matches the pre-fix single-item behaviour', () => {
    const ctx = editorWithTiers()
    ctx.surpriseLayout()
    ctx.setTierType('anchor', { letterSpacing: -1 })
    const t = ctx.template.value as TemplateV3
    const hero = t.elements.find(e => e.id === 'tier_anchor_0') as any
    expect(hero?.style?.letterSpacing).toBe(-1)
  })

  // -- Round-2a Task 10: editor unclamp + auto-overhang -----------------------

  it('nudgeSelected past the canvas edge goes negative and sets overhang', () => {
    const ctx = useGridEditor(makeStarterTemplate('nudge-overhang'))
    ctx.addText()   // default placement lands at col 1 (selects the new element)
    const id = ctx.selectedId.value!
    const before = ctx.template.value.elements.find(e => e.id === id)!.region
    expect(before.col).toBe(1)
    ctx.nudgeSelected(-2, 0)
    ctx.nudgeSelected(-2, 0)
    const el = ctx.template.value.elements.find(e => e.id === id)!
    expect(el.region.col).toBeLessThan(0)
    expect(el.overhang).toBe(true)
  })

  it('nudging back fully inside clears overhang', () => {
    const ctx = useGridEditor(makeStarterTemplate('nudge-overhang-clear'))
    ctx.addText()
    const id = ctx.selectedId.value!
    ctx.nudgeSelected(-2, 0)
    ctx.nudgeSelected(-2, 0)
    expect(ctx.template.value.elements.find(e => e.id === id)!.overhang).toBe(true)
    ctx.nudgeSelected(4, 0)   // back to the original in-bounds col
    const el = ctx.template.value.elements.find(e => e.id === id)!
    expect(el.region.col).toBe(1)
    expect(el.overhang).toBeFalsy()
  })

  it('nudgeSelected sanity-clamps a runaway drag at roughly ±2x the grid span', () => {
    const ctx = useGridEditor(makeStarterTemplate('nudge-runaway'))
    ctx.addText()
    const id = ctx.selectedId.value!
    ctx.nudgeSelected(-1000, 0)   // absurd single nudge
    const el = ctx.template.value.elements.find(e => e.id === id)!
    // Sanity floor is generous but finite — nowhere near -1000.
    expect(el.region.col).toBeGreaterThan(-100)
    expect(el.overhang).toBe(true)
    const clampedCol = el.region.col
    ctx.nudgeSelected(-1000, 0)   // repeat — must not drift further
    expect(ctx.template.value.elements.find(e => e.id === id)!.region.col).toBe(clampedCol)
  })

  // -- Round-2a final-fix 8: overhang flag is global but regions are per-scope

  it('a class-scoped (non-master) edit landing back in-bounds does NOT clear a master-set overhang flag; a subsequent MASTER edit does', () => {
    const ctx = useGridEditor(makeStarterTemplate('overhang-scope'))
    ctx.addText()
    const id = ctx.selectedId.value!

    // 1. Master off-grid nudge — sets overhang, el.region goes off-grid.
    ctx.nudgeSelected(-2, 0)
    ctx.nudgeSelected(-2, 0)
    expect(ctx.template.value.elements.find(e => e.id === id)!.overhang).toBe(true)
    const masterRegionOffGrid = ctx.template.value.elements.find(e => e.id === id)!.region.col

    // 2. Switch to a non-master output — regionScope resets to 'class'.
    ctx.addOutput('9x16')
    expect(ctx.isMaster.value).toBe(false)
    expect(ctx.regionScope.value).toBe('class')

    // Nudge back to exactly the in-bounds edge for THIS scope — writes
    // el.regionByClass[cls], never touching el.region.
    const rClass = ctx.selectedResolved.value!.region!
    const maxColClass = ctx.metrics.value.cols - rClass.colSpan + 1
    ctx.nudgeSelected(maxColClass - rClass.col, 0)
    const afterClassEdit = ctx.template.value.elements.find(e => e.id === id)!
    expect(afterClassEdit.overhang).toBe(true)             // STAYS — master region is still off-grid
    expect(afterClassEdit.region.col).toBe(masterRegionOffGrid)   // el.region untouched by the class-scoped edit

    // 3. Back to the master output — a master-scoped edit landing in-bounds
    // is the ONLY thing that may clear the flag.
    ctx.selectOutput('1x1')
    expect(ctx.isMaster.value).toBe(true)
    const rMaster = ctx.selectedResolved.value!.region!
    const maxColMaster = ctx.metrics.value.cols - rMaster.colSpan + 1
    ctx.nudgeSelected(maxColMaster - rMaster.col, 0)
    const afterMasterEdit = ctx.template.value.elements.find(e => e.id === id)!
    expect(afterMasterEdit.overhang).toBeFalsy()
  })

  it('duplicateElement of an in-bounds element still lands in-bounds (clamp kept)', () => {
    const ctx = useGridEditor(makeStarterTemplate('duplicate-clamped'))
    ctx.addText()
    const id = ctx.selectedId.value!
    const dupId = ctx.duplicateElement(id)!
    const dup = ctx.template.value.elements.find(e => e.id === dupId)!
    const m = ctx.metrics.value
    expect(dup.region.col).toBeGreaterThanOrEqual(1)
    expect(dup.region.col + dup.region.colSpan - 1).toBeLessThanOrEqual(m.cols)
    expect(dup.region.row).toBeGreaterThanOrEqual(1)
    expect(dup.region.row + dup.region.rowSpan - 1).toBeLessThanOrEqual(m.rows)
    expect(dup.overhang).toBeFalsy()
  })
})
