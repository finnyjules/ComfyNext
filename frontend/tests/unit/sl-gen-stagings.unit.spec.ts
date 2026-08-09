import { describe, it, expect } from 'vitest'
import { STAGINGS, getStaging, type StagingInput } from '~~/shared/template-grid/generate/stagings'
import { validateGenerated } from '~~/shared/template-grid/generate/validate'
import { makeRng } from '~~/shared/template-grid/generate/rng'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import { fineGridDims } from '~~/shared/template-grid/grid'
import { makeStarterTemplate } from '~~/shared/template-grid/starter'
import type { TemplateV3, Tiers } from '~~/shared/template-grid/types'

const LEVELS = ['caption', 'body', 'subhead', 'headline', 'display']
const HERO_SCALES = [0.10, 0.14, 0.18] as const
const CANVAS = { w: 1080, h: 1440 }
const TIERS: Tiers = {
  hero: [{ content: 'MAT + FEST' }],
  anchor: [{ content: '15—26 June' }],
  support: [{ content: 'Street food · Dining' }, { content: 'Live music · Market' }],
  fineprint: [{ content: 'Slakthus · Hall 3' }, { content: 'Free entry · All ages' }],
}
function input(over: Partial<StagingInput> = {}): StagingInput {
  return { tiers: TIERS, cols: 12, rows: 16, rng: makeRng(1), knobs: {}, canvas: CANVAS, ...over }
}
/** Single-item-per-tier fixture — the other half of the "1-item AND
 *  2/2-item" validator contract every Family A staging must satisfy. */
const ONE_EACH_TIERS: Tiers = {
  hero: [{ content: 'MAT + FEST' }],
  anchor: [{ content: '15—26 June' }],
  support: [{ content: 'Street food · Dining' }],
  fineprint: [{ content: 'Slakthus · Hall 3' }],
}

describe('staging: tower', () => {
  const tower = getStaging('tower')!
  it('is registered', () => { expect(tower).toBeTruthy() })
  it('places one element per enabled tier item, tagged staging origin', () => {
    const els = tower.compose(input()).elements
    // 1 hero + 1 anchor + 2 support + 2 fineprint
    expect(els).toHaveLength(6)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('carries each tier content through', () => {
    const els = tower.compose(input()).elements
    expect(els.map(e => (e as any).content)).toContain('MAT + FEST')
    expect(els.map(e => (e as any).content)).toContain('Slakthus · Hall 3')
    expect(els.map(e => (e as any).content)).toContain('Live music · Market')
    expect(els.map(e => (e as any).content)).toContain('Free entry · All ages')
  })
  it('gives the hero the largest type level', () => {
    const els = tower.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    const fine = els.find(e => e.id === 'tier_fineprint_0')! as any
    expect(LEVELS.indexOf(hero.level)).toBeGreaterThan(LEVELS.indexOf(fine.level))
  })
  it('keeps every region inside the grid', () => {
    for (const e of tower.compose(input()).elements) {
      expect(e.region.col).toBeGreaterThanOrEqual(1)
      expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
      expect(e.region.row).toBeGreaterThanOrEqual(1)
      expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
    }
  })
  it('is deterministic per seed', () => {
    expect(tower.compose(input({ rng: makeRng(3) })).elements).toEqual(tower.compose(input({ rng: makeRng(3) })).elements)
  })
})

describe('staging: split + frame registered and valid', () => {
  for (const id of ['split', 'frame']) {
    it(`${id} places tiers inside the grid with hero largest`, () => {
      const s = getStaging(id)!
      expect(s).toBeTruthy()
      const els = s.compose(input()).elements
      expect(els.length).toBeGreaterThanOrEqual(3)
      for (const e of els) {
        expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
        expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
      }
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      const fine = els.find(e => e.id === 'tier_fineprint_0')! as any
      expect(LEVELS.indexOf(hero.level)).toBeGreaterThanOrEqual(LEVELS.indexOf(fine.level))
    })
  }
  it('split differs from tower placement', () => {
    const t = getStaging('tower')!.compose(input()).elements
    const s = getStaging('split')!.compose(input()).elements
    expect(JSON.stringify(s.map(e => e.region))).not.toBe(JSON.stringify(t.map(e => e.region)))
  })
})

describe('staging: full library', () => {
  it('registers all fifteen stagings', () => {
    expect(STAGINGS.map(s => s.id).sort()).toEqual([
      'band_footer', 'band_header', 'centered', 'corner', 'cover', 'editorial',
      'frame', 'index', 'ledger', 'lockup', 'manifesto', 'split', 'stacked',
      'statement', 'tower',
    ])
  })
  it('every staging produces distinct placement and stays in-grid', () => {
    const shapes = new Set<string>()
    for (const s of STAGINGS) {
      const els = s.compose(input()).elements
      for (const e of els) {
        expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
        expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
      }
      shapes.add(JSON.stringify(els.map(e => [e.id, e.region])))
    }
    expect(shapes.size).toBe(STAGINGS.length) // no two stagings are identical
  })
  it('every staging declares a heroScale knob', () => {
    for (const s of STAGINGS) {
      const knob = s.knobs.find(k => k.id === 'heroScale')
      expect(knob, `${s.id} is missing heroScale knob`).toBeTruthy()
      expect(knob!.pick).toEqual([0.10, 0.14, 0.18])
    }
  })
})

describe('staging: no intra-staging overlap', () => {
  // Round 1 checked this with a local pairwise scan; round 2a moved collision
  // detection into validateGenerated (declared `overlaps` pairs are exempt).
  // Under `input()` (no `image` wired) every staging from Families A/B, plus
  // Family C's `cover`/`lockup`, declares zero overlaps — their only declared
  // pairs name `img_0`, which doesn't exist without a wired image. Family C's
  // `band_header`/`band_footer` are the one legitimate exception (round-2b
  // Task 4): `band_0` is a background shape that renders regardless of photo
  // presence, and hero/anchor/(fineprint|support) genuinely — and
  // intentionally — sit on top of it, so those pairs stay declared with or
  // without an image. Either way, the standard 4-tier (2-support/2-fineprint)
  // fixture must validate CLEAN end to end (off-grid + overlap + type-size-
  // count all pass) — proving the whole pipeline, not just the collision
  // check.
  const BAND_FAMILY_IDS = new Set(['band_header', 'band_footer'])
  for (const s of STAGINGS) {
    it(`${s.id}: validates clean (no overlap, off-grid, or type-size violations) under default knobs`, () => {
      const result = s.compose(input())
      if (!BAND_FAMILY_IDS.has(s.id)) expect(result.overlaps ?? []).toEqual([])
      const { ok, reasons } = validateGenerated(result, 12, 16)
      expect(ok, reasons.join(' ')).toBe(true)
    })
  }
})

describe('staging: tier lists — every item renders, nothing dropped', () => {
  for (const s of STAGINGS) {
    it(`${s.id}: renders both support items at distinct regions`, () => {
      const els = s.compose(input()).elements
      const s0 = els.find(e => e.id === 'tier_support_0') as any
      const s1 = els.find(e => e.id === 'tier_support_1') as any
      expect(s0, `${s.id} missing tier_support_0`).toBeTruthy()
      expect(s1, `${s.id} missing tier_support_1`).toBeTruthy()
      expect(s0.region).not.toEqual(s1.region)
      expect(s0.content).toBe('Street food · Dining')
      expect(s1.content).toBe('Live music · Market')
    })
    it(`${s.id}: renders both fineprint items at distinct regions`, () => {
      const els = s.compose(input()).elements
      const f0 = els.find(e => e.id === 'tier_fineprint_0') as any
      const f1 = els.find(e => e.id === 'tier_fineprint_1') as any
      expect(f0, `${s.id} missing tier_fineprint_0`).toBeTruthy()
      expect(f1, `${s.id} missing tier_fineprint_1`).toBeTruthy()
      expect(f0.region).not.toEqual(f1.region)
      expect(f0.content).toBe('Slakthus · Hall 3')
      expect(f1.content).toBe('Free entry · All ages')
    })
  }

  it('tower (Round-2b Table B rebuild): a single support item keeps the photo\'s FULL row span (4), not the 2-item compact half-span', () => {
    // Table B: "support left of the photo ([0..0.28C] × photo's rows)" — the
    // photo's row band is rowBand(0.48, 0.72, 16) = rowSpan 4 (rows 9-12 on
    // the 12x16 fixture); a lone support item gets that whole band back,
    // exactly like every other staging's "generous single-item span" pattern.
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('tower')!.compose(input({ tiers: tiersWithOneSupport })).elements
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(4)
  })

  it('split: a single support item keeps the round-1 generous rowSpan (3), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('split')!.compose(input({ tiers: tiersWithOneSupport })).elements
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(3)
  })

  it('editorial: a single support item keeps the round-1 generous rowSpan (4), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('editorial')!.compose(input({ tiers: tiersWithOneSupport })).elements
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(4)
  })

  it('index: a single support item keeps the round-1 generous rowSpan (3), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('index')!.compose(input({ tiers: tiersWithOneSupport })).elements
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(3)
  })

  it('disabled item 0 with a valid item 1 renders the valid item (filtered list is the source of truth)', () => {
    const tiersWithDisabledHero: Tiers = {
      ...TIERS,
      hero: [{ content: 'DISABLED HERO', enabled: false }, { content: 'REAL HERO' }],
    }
    const tower = getStaging('tower')!
    const els = tower.compose(input({ tiers: tiersWithDisabledHero })).elements
    const hero = els.find(e => e.id === 'tier_hero_0') as any
    expect(hero).toBeTruthy()
    expect(hero.content).toBe('REAL HERO')
    expect(els.some(e => (e as any).content === 'DISABLED HERO')).toBe(false)
  })
})

describe('staging: dramatic hero + anchor type', () => {
  // `manifesto` inverts the usual mass relationship (Family A table + the
  // round-2b self-review correction): the ANCHOR is the giant heroScale-sized
  // element (the numeral-as-graphic move) and the HERO is the small ~0.45×
  // corner mark — the opposite of every other staging. `lockup` (Family C,
  // round-2b Task 4) scales its hero to HALF heroScale (a small title+date
  // jewel, not a giant overprint) — a different divergence from the same
  // generic "hero === heroScale × canvas.h" assumption. Both get their own
  // dedicated describe block below; this loop still guards every other
  // staging unchanged.
  for (const s of STAGINGS) {
    if (s.id === 'manifesto' || s.id === 'lockup') continue
    it(`${s.id}: hero fontSize follows the heroScale knob × canvas.h`, () => {
      for (const heroScale of HERO_SCALES) {
        const els = s.compose(input({ knobs: { heroScale } })).elements
        const hero = els.find(e => e.id === 'tier_hero_0')! as any
        expect(hero.style.fontSize).toBe(Math.round(heroScale * CANVAS.h))
      }
    })
    it(`${s.id}: hero has tight lineHeight and negative letterSpacing`, () => {
      const els = s.compose(input()).elements
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      expect(hero.style.lineHeight).toBe(0.92)
      expect(hero.style.letterSpacing).toBeLessThan(0)
    })
    it(`${s.id}: anchor fontSize tracks 0.45 × hero fontSize`, () => {
      const els = s.compose(input()).elements
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
      expect(Math.abs(anchor.style.fontSize - Math.round(0.45 * hero.style.fontSize))).toBeLessThanOrEqual(1)
      expect(anchor.style.letterSpacing).toBeLessThan(0)
    })
  }

  it('manifesto: hero fontSize follows the INVERTED (0.45×) relationship — anchor is the giant one', () => {
    for (const heroScale of HERO_SCALES) {
      const els = getStaging('manifesto')!.compose(input({ knobs: { heroScale } })).elements
      const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
      expect(anchor.style.fontSize).toBe(Math.round(heroScale * CANVAS.h))
    }
  })
  it('manifesto: anchor has tight lineHeight and negative letterSpacing (it plays the hero role)', () => {
    const els = getStaging('manifesto')!.compose(input()).elements
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(anchor.style.lineHeight).toBe(0.92)
    expect(anchor.style.letterSpacing).toBeLessThan(0)
  })
  it('manifesto: hero fontSize tracks 0.45 × anchor fontSize (it plays the anchor role)', () => {
    const els = getStaging('manifesto')!.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(Math.abs(hero.style.fontSize - Math.round(0.45 * anchor.style.fontSize))).toBeLessThanOrEqual(1)
    expect(hero.style.letterSpacing).toBeLessThan(0)
  })

  it('lockup: hero fontSize follows the HALVED (0.5×heroScale) relationship — a small jewel, not a giant overprint', () => {
    for (const heroScale of HERO_SCALES) {
      const els = getStaging('lockup')!.compose(input({ knobs: { heroScale } })).elements
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      expect(hero.style.fontSize).toBe(Math.round(0.5 * heroScale * CANVAS.h))
    }
  })
  it('lockup: hero has tight lineHeight and negative letterSpacing, same drama shape at the smaller scale', () => {
    const els = getStaging('lockup')!.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.style.lineHeight).toBe(0.92)
    expect(hero.style.letterSpacing).toBeLessThan(0)
  })
  it('lockup: anchor fontSize tracks 0.45 × the (already-halved) hero fontSize', () => {
    const els = getStaging('lockup')!.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(Math.abs(anchor.style.fontSize - Math.round(0.45 * hero.style.fontSize))).toBeLessThanOrEqual(1)
    expect(anchor.style.letterSpacing).toBeLessThan(0)
  })
})

/** Round-2a Task 5c regression: a freshly generated Smart Layout must never
 *  truncate the hero to a single character + ellipsis. Reproduces the real
 *  live-editor path — `SmartLayoutEditorModal`'s fresh-open promotes the v2
 *  starter to `{ ...v2, version: 3 }` before calling `generate()` (see
 *  `app/components/vue-canvas/SmartLayoutEditorModal.vue`) — then runs the
 *  staging's raw `compose()` output through the real resolver
 *  (`resolveFormat`) on the starter's master format (1x1, 1080×1080, margin
 *  72), for every staging × every `heroScale` roll.
 *
 *  Root cause this guards: `generate()` used to compose staging regions in a
 *  hardcoded 12×16 authoring grid, independent of the grid `resolveFormat`
 *  actually interprets `el.region` against (`fineGridDims` of the master
 *  format — 78×78 once a fresh layout is promoted to v3, since nothing sets
 *  `grid.columns`/`rows`). A region authored as "full width" (colSpan: 12)
 *  read against a 78-wide grid lands at ~15% of the canvas — combined with
 *  the hero's explicit dramatic `style.fontSize` disabling `fitText`'s
 *  auto-shrink (an explicit size is meant to be honoured exactly), the fit
 *  pass had zero degrees of freedom and fell straight through to
 *  `shrink-then-truncate`'s truncate step, producing "S…". */
describe('staging: dramatic hero never truncates (resolver-level, starter square)', () => {
  const HERO_CONTENT = 'Summer Sale'
  const REGRESSION_TIERS: Tiers = {
    hero: [{ content: HERO_CONTENT }],
    anchor: [{ content: 'June 1—30' }],
    support: [{ content: 'In stores now' }],
    fineprint: [{ content: 'Terms apply' }],
  }

  function resolvedHeroFor(stagingId: string, heroScale: number) {
    const staging = getStaging(stagingId)!
    const starter = makeStarterTemplate('t') as any
    starter.tiers = REGRESSION_TIERS
    // Mirrors SmartLayoutEditorModal's fresh-open: `{ ...v2, version: 3 }`,
    // no `sections`/`grid.columns`/`grid.rows` added — the exact promotion
    // that exposes the coordinate-space mismatch.
    const v3ified: TemplateV3 = { ...starter, version: 3, sections: [] }
    const masterFormat = v3ified.formats[v3ified.master]!
    const { cols, rows } = fineGridDims(v3ified, masterFormat)
    const canvas = { w: masterFormat.w, h: masterFormat.h }
    const result = staging.compose({
      tiers: REGRESSION_TIERS, cols, rows, canvas,
      rng: makeRng(1), knobs: { heroScale },
    })
    const t: TemplateV3 = { ...v3ified, elements: result.elements, order: result.elements.map(e => e.id) }
    const resolved = resolveFormat(t, v3ified.master)
    return resolved.elements.find(e => e.el.id.startsWith('tier_hero'))
  }

  for (const staging of STAGINGS) {
    for (const heroScale of HERO_SCALES) {
      it(`${staging.id} heroScale=${heroScale}: hero fits its full content, not truncated`, () => {
        const hero = resolvedHeroFor(staging.id, heroScale)
        expect(hero).toBeTruthy()
        expect(hero!.culled).toBe(false)
        // `fitText` only rewrites `content` on the truncate path (an ellipsis
        // + fewer words/chars than the source) — every non-truncating
        // outcome (fits fully, or clips visually but keeps the full string)
        // leaves `content` byte-identical to what was authored.
        expect(hero!.text?.content).toBe(HERO_CONTENT)
      })
    }
  }
})

// Round-2b Task 2 — Family A, the type-dominant staging family. Four new
// composers appended additively to the registry (existing six untouched).
// Per the family table's self-review + task brief: no photos, capacity
// hero 1/anchor 1/support n/fineprint n (overflow stacks downward), and
// `index`'s ruled-table rule shapes are `rule_<i>` — one per support item.

describe('staging: statement', () => {
  const statement = getStaging('statement')!
  it('is registered', () => { expect(statement).toBeTruthy() })
  it('places one element per enabled tier item, tagged staging origin', () => {
    const els = statement.compose(input()).elements
    expect(els).toHaveLength(6)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('validates clean under default knobs — 2/2-item tier set', () => {
    const { ok, reasons } = validateGenerated(statement.compose(input()), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('validates clean under default knobs — 1-item tier set', () => {
    const { ok, reasons } = validateGenerated(statement.compose(input({ tiers: ONE_EACH_TIERS })), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('is deterministic per seed', () => {
    expect(statement.compose(input({ rng: makeRng(3) })).elements)
      .toEqual(statement.compose(input({ rng: makeRng(3) })).elements)
  })
  it('crop:"left" gives the hero overhang, off-grid on the left edge', () => {
    const els = statement.compose(input({ knobs: { crop: 'left' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.overhang).toBe(true)
    expect(hero.region.col).toBeLessThan(1)
  })
  it('crop:"none" keeps the hero fully in-grid, no overhang', () => {
    const els = statement.compose(input({ knobs: { crop: 'none' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.overhang).toBeFalsy()
    expect(hero.region.col).toBeGreaterThanOrEqual(1)
  })
  it("an item's own type override still wins over the staging's voice defaults", () => {
    const tiers: Tiers = { ...TIERS, hero: [{ content: 'MAT + FEST', type: { color: '#ff0000' } }] }
    const els = statement.compose(input({ tiers })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.style.color).toBe('#ff0000')
  })
})

describe('staging: manifesto', () => {
  const manifesto = getStaging('manifesto')!
  it('is registered', () => { expect(manifesto).toBeTruthy() })
  it('places one element per enabled tier item, plus the rule_0 hairline shape', () => {
    const els = manifesto.compose(input()).elements
    expect(els).toHaveLength(7) // hero + anchor + 2 support + 2 fineprint + rule_0
    const rule = els.find(e => e.id === 'rule_0')! as any
    expect(rule.type).toBe('shape')
    expect(rule.shape).toBe('rect')
  })
  it('validates clean under default knobs — 2/2-item tier set', () => {
    const { ok, reasons } = validateGenerated(manifesto.compose(input()), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('validates clean under default knobs — 1-item tier set', () => {
    const { ok, reasons } = validateGenerated(manifesto.compose(input({ tiers: ONE_EACH_TIERS })), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('is deterministic per seed', () => {
    expect(manifesto.compose(input({ rng: makeRng(3) })).elements)
      .toEqual(manifesto.compose(input({ rng: makeRng(3) })).elements)
  })
  it('anchor fontSize equals the heroScale sizing (inverted mass — the numeral is the graphic)', () => {
    for (const heroScale of HERO_SCALES) {
      const els = manifesto.compose(input({ knobs: { heroScale } })).elements
      const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
      expect(anchor.style.fontSize).toBe(Math.round(heroScale * CANVAS.h))
    }
  })
  it('voice:"serif" sets the anchor fontFamily to Playfair Display', () => {
    const els = manifesto.compose(input({ knobs: { voice: 'serif' } })).elements
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(anchor.style.fontFamily).toBe('Playfair Display')
  })
  it('voice:"grotesk" leaves the anchor fontFamily unset (inherits brand)', () => {
    const els = manifesto.compose(input({ knobs: { voice: 'grotesk' } })).elements
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(anchor.style.fontFamily).toBeUndefined()
  })
})

describe('staging: ledger', () => {
  const ledger = getStaging('ledger')!
  it('is registered', () => { expect(ledger).toBeTruthy() })
  it('places one rule_i hairline shape per support item, none extra', () => {
    const els = ledger.compose(input()).elements
    const rule0 = els.find(e => e.id === 'rule_0')! as any
    const rule1 = els.find(e => e.id === 'rule_1')! as any
    expect(rule0.type).toBe('shape')
    expect(rule1.type).toBe('shape')
    expect(els.filter(e => e.type === 'shape')).toHaveLength(2) // 2 support items, 2 rules
  })
  it('validates clean under default knobs — 2/2-item tier set', () => {
    const { ok, reasons } = validateGenerated(ledger.compose(input()), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('validates clean under default knobs — 1-item tier set', () => {
    const { ok, reasons } = validateGenerated(ledger.compose(input({ tiers: ONE_EACH_TIERS })), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
    const els = ledger.compose(input({ tiers: ONE_EACH_TIERS })).elements
    expect(els.filter(e => e.type === 'shape')).toHaveLength(1) // 1 support item, 1 rule
  })
  it('is deterministic per seed', () => {
    expect(ledger.compose(input({ rng: makeRng(3) })).elements)
      .toEqual(ledger.compose(input({ rng: makeRng(3) })).elements)
  })
})

describe('staging: stacked', () => {
  const stacked = getStaging('stacked')!
  it('is registered', () => { expect(stacked).toBeTruthy() })
  it('places one element per enabled tier item, tagged staging origin', () => {
    const els = stacked.compose(input()).elements
    expect(els).toHaveLength(6)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('validates clean under default knobs — 2/2-item tier set', () => {
    const { ok, reasons } = validateGenerated(stacked.compose(input()), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('validates clean under default knobs — 1-item tier set', () => {
    const { ok, reasons } = validateGenerated(stacked.compose(input({ tiers: ONE_EACH_TIERS })), 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('is deterministic per seed', () => {
    expect(stacked.compose(input({ rng: makeRng(3) })).elements)
      .toEqual(stacked.compose(input({ rng: makeRng(3) })).elements)
  })
  it('align:"right" mirrors the flush side (hero/anchor text align flips)', () => {
    const left = stacked.compose(input({ knobs: { align: 'left' } })).elements
    const right = stacked.compose(input({ knobs: { align: 'right' } })).elements
    const heroL = left.find(e => e.id === 'tier_hero_0')! as any
    const heroR = right.find(e => e.id === 'tier_hero_0')! as any
    expect(heroL.style.align).toBe('left')
    expect(heroR.style.align).toBe('right')
  })
})

// Round-2b Task 3 — Family B, photo-as-block. tower/split/frame are
// REBUILT in place (round-1 bodies replaced, ids/knob-names-as-a-concept
// kept but the actual knob SETS are regenerated per the family table — see
// the task report for the full old->new knob diff); `corner` is new. Per
// the table's degrade rule: no `input.image` -> no `img_0` element, and
// every text tier keeps the position it would have had WITH a photo (the
// photo's area just becomes air) — none of these composers reflow text
// based on image presence.
const IMAGE_TOKEN = '{{ props.image_layer_1 }}'
const PHOTO_BLOCK_IDS = ['tower', 'split', 'frame', 'corner'] as const

describe('staging: Family B — photo-as-block registration', () => {
  it('corner is registered', () => {
    expect(getStaging('corner')).toBeTruthy()
  })
  it('every Family B staging declares heroScale plus its own knobs', () => {
    expect(getStaging('tower')!.knobs.map(k => k.id).sort()).toEqual(['align', 'heroScale'])
    expect(getStaging('split')!.knobs.map(k => k.id).sort()).toEqual(['heroScale', 'side'])
    expect(getStaging('frame')!.knobs.map(k => k.id).sort()).toEqual(['heroScale'])
    expect(getStaging('corner')!.knobs.map(k => k.id).sort()).toEqual(['crop', 'heroOrientation', 'heroScale'])
  })
})

describe('staging: Family B — img_0 presence tracks input.image', () => {
  for (const id of PHOTO_BLOCK_IDS) {
    it(`${id}: places img_0 (origin staging, content = the token, fit cover) when image is wired`, () => {
      const els = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements
      const img = els.find(e => e.id === 'img_0') as any
      expect(img, `${id} missing img_0 with an image wired`).toBeTruthy()
      expect(img.type).toBe('image')
      expect(img.content).toBe(IMAGE_TOKEN)
      expect(img.origin).toBe('staging')
      expect(img.style?.fit).toBe('cover')
    })
    it(`${id}: places NO img_0 when no image is wired (degrade)`, () => {
      const els = getStaging(id)!.compose(input()).elements
      expect(els.find(e => e.id === 'img_0')).toBeUndefined()
    })
    it(`${id}: text tiers keep identical regions with and without an image (degrade doesn't reflow)`, () => {
      const withImage = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements
        .filter(e => e.type === 'text').map(e => [e.id, e.region])
      const withoutImage = getStaging(id)!.compose(input()).elements
        .filter(e => e.type === 'text').map(e => [e.id, e.region])
      expect(withImage).toEqual(withoutImage)
    })
  }
})

describe('staging: Family B — validator matrix (1-item / 2-item x image / no-image)', () => {
  for (const id of PHOTO_BLOCK_IDS) {
    for (const tiersLabel of ['2/2-item', '1-item'] as const) {
      const tiers = tiersLabel === '1-item' ? ONE_EACH_TIERS : TIERS
      for (const imageLabel of ['image', 'no-image'] as const) {
        const image = imageLabel === 'image' ? IMAGE_TOKEN : undefined
        it(`${id}: validates clean — ${tiersLabel}, ${imageLabel}`, () => {
          const result = getStaging(id)!.compose(input({ tiers, image }))
          const { ok, reasons } = validateGenerated(result, 12, 16)
          expect(ok, reasons.join(' ')).toBe(true)
        })
      }
    }
  }
})

describe('staging: Family B — determinism', () => {
  for (const id of PHOTO_BLOCK_IDS) {
    it(`${id}: identical seed produces identical output, with and without an image`, () => {
      const s = getStaging(id)!
      expect(s.compose(input({ rng: makeRng(3) })).elements)
        .toEqual(s.compose(input({ rng: makeRng(3) })).elements)
      expect(s.compose(input({ rng: makeRng(3), image: IMAGE_TOKEN })).elements)
        .toEqual(s.compose(input({ rng: makeRng(3), image: IMAGE_TOKEN })).elements)
    })
  }
})

describe('staging: tower — geometry per Table B (walked on the 12x16 fixture)', () => {
  const tower = getStaging('tower')!
  it('fineprint sits corners row 0, hero rows [0.10..0.44] full width', () => {
    const els = tower.compose(input()).elements
    const fine0 = els.find(e => e.id === 'tier_fineprint_0')!.region
    const fine1 = els.find(e => e.id === 'tier_fineprint_1')!.region
    const hero = els.find(e => e.id === 'tier_hero_0')!.region
    expect(fine0).toEqual({ col: 1, colSpan: 6, row: 1, rowSpan: 1 })
    expect(fine1).toEqual({ col: 7, colSpan: 6, row: 1, rowSpan: 1 })
    expect(hero).toEqual({ col: 1, colSpan: 12, row: 3, rowSpan: 5 })
  })
  it('photo block is centered [0.48..0.72]x[0.30C..0.70C] when an image is wired', () => {
    const els = tower.compose(input({ image: IMAGE_TOKEN })).elements
    const img = els.find(e => e.id === 'img_0')!.region
    expect(img).toEqual({ col: 5, colSpan: 4, row: 9, rowSpan: 4 })
  })
  it('anchor is a bottom-flush full-width slab [0.76..0.94]', () => {
    const els = tower.compose(input()).elements
    const anchor = els.find(e => e.id === 'tier_anchor_0')!.region
    expect(anchor).toEqual({ col: 1, colSpan: 12, row: 13, rowSpan: 3 })
  })
  it('support sits left of the photo, sharing its row band, regardless of image presence', () => {
    const withImage = tower.compose(input({ image: IMAGE_TOKEN })).elements
    const withoutImage = tower.compose(input()).elements
    for (const els of [withImage, withoutImage]) {
      const s0 = els.find(e => e.id === 'tier_support_0')!.region
      const s1 = els.find(e => e.id === 'tier_support_1')!.region
      expect(s0).toEqual({ col: 1, colSpan: 3, row: 9, rowSpan: 2 })
      expect(s1).toEqual({ col: 1, colSpan: 3, row: 11, rowSpan: 2 })
    }
  })
})

describe('staging: split — hard split, no overlaps, photo bleeds full height', () => {
  const split = getStaging('split')!
  it('img_0 spans the full row height and carries bleed:true', () => {
    const els = split.compose(input({ image: IMAGE_TOKEN })).elements
    const img = els.find(e => e.id === 'img_0')! as any
    expect(img.bleed).toBe(true)
    expect(img.region.row).toBe(1)
    expect(img.region.rowSpan).toBe(16)
  })
  it('default (no side override): photo takes the right half, text column the left half', () => {
    const els = split.compose(input({ image: IMAGE_TOKEN })).elements
    const img = els.find(e => e.id === 'img_0')! as any
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(img.region.col).toBeGreaterThan(hero.region.col + hero.region.colSpan - 1)
  })
  it('side:"left" mirrors the whole layout — photo moves to the left half', () => {
    const mirrored = split.compose(input({ image: IMAGE_TOKEN, knobs: { side: 'left' } })).elements
    const img = mirrored.find(e => e.id === 'img_0')! as any
    const hero = mirrored.find(e => e.id === 'tier_hero_0')! as any
    expect(img.region.col).toBe(1)
    expect(hero.region.col).toBeGreaterThan(img.region.col + img.region.colSpan - 1)
    expect(hero.style.align).toBe('right')
  })
  it('declares no overlaps — the split is hard by construction', () => {
    const result = split.compose(input({ image: IMAGE_TOKEN }))
    expect(result.overlaps ?? []).toEqual([])
  })
})

describe('staging: frame — declared (hero, img_0) overlap, img behind hero', () => {
  const frame = getStaging('frame')!
  it('declares the (tier_hero_0, img_0) overlap when an image is wired, and validates clean', () => {
    const result = frame.compose(input({ image: IMAGE_TOKEN }))
    expect(result.overlaps).toEqual([['tier_hero_0', 'img_0']])
    const { ok, reasons } = validateGenerated(result, 12, 16)
    expect(ok, reasons.join(' ')).toBe(true)
  })
  it('img_0 precedes tier_hero_0 in elements — img behind, hero in front (back->front z-order)', () => {
    const els = frame.compose(input({ image: IMAGE_TOKEN })).elements
    const imgIndex = els.findIndex(e => e.id === 'img_0')
    const heroIndex = els.findIndex(e => e.id === 'tier_hero_0')
    expect(imgIndex).toBeGreaterThanOrEqual(0)
    expect(imgIndex).toBeLessThan(heroIndex)
  })
  it('declares no overlap when no image is wired (nothing to overlap)', () => {
    const result = frame.compose(input())
    expect(result.overlaps ?? []).toEqual([])
  })
  it("hero's region genuinely crosses the photo's edge (the overlap is real, not just declared)", () => {
    const els = frame.compose(input({ image: IMAGE_TOKEN })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')!.region
    const img = els.find(e => e.id === 'img_0')!.region
    const colsOverlap = hero.col <= img.col + img.colSpan - 1 && img.col <= hero.col + hero.colSpan - 1
    const rowsOverlap = hero.row <= img.row + img.rowSpan - 1 && img.row <= hero.row + hero.rowSpan - 1
    expect(colsOverlap && rowsOverlap).toBe(true)
  })
})

describe('staging: corner — pinned photo, crop overhang, vertical hero', () => {
  const corner = getStaging('corner')!
  it('photo is pinned top-right and bleeds', () => {
    const els = corner.compose(input({ image: IMAGE_TOKEN })).elements
    const img = els.find(e => e.id === 'img_0')! as any
    expect(img.bleed).toBe(true)
    expect(img.region.row).toBe(1)
    expect(img.region.col + img.region.colSpan - 1).toBe(12) // touches the right edge
  })
  it('crop:"none" (default) keeps the hero fully in-grid, no overhang', () => {
    const els = corner.compose(input({ knobs: { crop: 'none' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.overhang).toBeFalsy()
    expect(hero.region.row + hero.region.rowSpan - 1).toBeLessThanOrEqual(16)
  })
  it('crop:"bottom" extends the hero rowSpan past the grid with overhang:true', () => {
    const els = corner.compose(input({ knobs: { crop: 'bottom' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.overhang).toBe(true)
    expect(hero.region.row + hero.region.rowSpan - 1).toBeGreaterThan(16)
  })
  it('heroOrientation:"horizontal" (default) leaves style.orientation unset', () => {
    const els = corner.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.style.orientation).toBeUndefined()
  })
  it('heroOrientation:"up" sets style.orientation and swaps to a tall, narrow region along the left edge', () => {
    const horizontal = corner.compose(input()).elements.find(e => e.id === 'tier_hero_0')!.region
    const els = corner.compose(input({ knobs: { heroOrientation: 'up' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.style.orientation).toBe('up')
    expect(hero.region.col).toBe(1)
    expect(hero.region.colSpan).toBeLessThan(horizontal.colSpan) // narrow
    expect(hero.region.rowSpan).toBeGreaterThan(horizontal.rowSpan) // tall
  })
  it('heroOrientation:"up" combined with crop:"bottom" still overhangs past the grid', () => {
    const els = corner.compose(input({ knobs: { heroOrientation: 'up', crop: 'bottom' } })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.overhang).toBe(true)
    expect(hero.style.orientation).toBe('up')
    expect(hero.region.row + hero.region.rowSpan - 1).toBeGreaterThan(16)
  })
  it('validates clean under the default crop:"none" / heroOrientation:"horizontal" knobs, image and no-image', () => {
    for (const image of [IMAGE_TOKEN, undefined]) {
      const result = corner.compose(input({ image }))
      const { ok, reasons } = validateGenerated(result, 12, 16)
      expect(ok, reasons.join(' ')).toBe(true)
    }
  })
  // Task 3 review minor: every crop x heroOrientation combo, not just each
  // knob varied alone, run through the real validator (image + no-image).
  it('every crop x heroOrientation combo validates clean, image and no-image', () => {
    for (const crop of ['bottom', 'none'] as const) {
      for (const heroOrientation of ['horizontal', 'up'] as const) {
        for (const image of [IMAGE_TOKEN, undefined]) {
          const result = corner.compose(input({ knobs: { crop, heroOrientation }, image }))
          const { ok, reasons } = validateGenerated(result, 12, 16)
          expect(ok, `crop:${crop} heroOrientation:${heroOrientation} image:${!!image} — ${reasons.join(' ')}`).toBe(true)
        }
      }
    }
  })
})

// Round-2b Task 4 — Family C, photo-as-field (cover/lockup/band_header/
// band_footer). The overprint/band family: heaviest user of declared
// overlaps + scrims. All four `supports.needsImage: true` — Task 1's
// surprise-pool filter excludes them without a wired image. Per the family
// table + task brief, `cover`/`lockup` overprint a FULL-BLEED photo (every
// text element declares an overlap with it, since it covers the whole
// grid); `band_header`/`band_footer` split a solid colour band from a
// full-bleed photo (`bandSize` scales both regions from one knob), with
// band text declaring overlap against `band_0` and photo text declaring
// overlap against `img_0`.
const FIELD_IDS = ['cover', 'lockup', 'band_header', 'band_footer'] as const
const BAND_IDS = ['band_header', 'band_footer'] as const

describe('staging: Family C — registration + needsImage + knobs', () => {
  it('all four are registered and declare supports.needsImage', () => {
    for (const id of FIELD_IDS) {
      const s = getStaging(id)!
      expect(s, `${id} not registered`).toBeTruthy()
      expect(s.supports?.needsImage).toBe(true)
    }
  })
  it('every Family C staging declares heroScale plus its own knobs', () => {
    expect(getStaging('cover')!.knobs.map(k => k.id).sort()).toEqual(['heroScale', 'scrim'])
    expect(getStaging('lockup')!.knobs.map(k => k.id).sort()).toEqual(['heroScale', 'scrim'])
    expect(getStaging('band_header')!.knobs.map(k => k.id).sort()).toEqual(['bandSize', 'heroScale', 'scrim'])
    expect(getStaging('band_footer')!.knobs.map(k => k.id).sort()).toEqual(['bandSize', 'heroScale'])
  })
})

describe('staging: Family C — img_0/band_0 presence, no crash without an image', () => {
  for (const id of FIELD_IDS) {
    it(`${id}: a direct compose() with no image doesn't crash and validates clean`, () => {
      const result = getStaging(id)!.compose(input())
      expect(result.elements.length).toBeGreaterThan(0)
      expect(result.elements.find(e => e.id === 'img_0')).toBeUndefined()
      const { ok, reasons } = validateGenerated(result, 12, 16)
      expect(ok, reasons.join(' ')).toBe(true)
    })
  }
  it('cover/lockup: no img_0 without a wired image; present with one', () => {
    for (const id of ['cover', 'lockup'] as const) {
      const withImage = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements.find(e => e.id === 'img_0')
      expect(withImage).toBeTruthy()
      expect((withImage as any).content).toBe(IMAGE_TOKEN)
    }
  })
  it('band_header/band_footer: band_0 always renders (image or not); img_0 tracks image presence', () => {
    for (const id of BAND_IDS) {
      for (const image of [IMAGE_TOKEN, undefined]) {
        const els = getStaging(id)!.compose(input({ image })).elements
        expect(els.find(e => e.id === 'band_0'), `${id} missing band_0`).toBeTruthy()
        const img = els.find(e => e.id === 'img_0')
        if (image) expect(img).toBeTruthy()
        else expect(img).toBeUndefined()
      }
    }
  })
})

describe('staging: Family C — cover/lockup full-bleed img_0 spans the whole grid', () => {
  for (const id of ['cover', 'lockup'] as const) {
    it(`${id}: img_0 region spans the full grid and carries bleed:true`, () => {
      const els = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements
      const img = els.find(e => e.id === 'img_0')! as any
      expect(img.bleed).toBe(true)
      expect(img.region).toEqual({ col: 1, colSpan: 12, row: 1, rowSpan: 16 })
    })
  }
})

describe('staging: Family C — cover/lockup scrim knob maps to hero style.panel', () => {
  for (const id of ['cover', 'lockup'] as const) {
    it(`${id}: scrim:"panel" sets hero style.panel to the token fill at 0.55 opacity`, () => {
      const els = getStaging(id)!.compose(input({ knobs: { scrim: 'panel' } })).elements
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      expect(hero.style.panel).toEqual({ fill: '{{ brand.background }}', opacity: 0.55 })
    })
    it(`${id}: scrim:"none" leaves hero style.panel unset`, () => {
      const els = getStaging(id)!.compose(input({ knobs: { scrim: 'none' } })).elements
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      expect(hero.style.panel).toBeUndefined()
    })
  }
})

describe('staging: Family C — band_header scrim knob maps to support style.panel', () => {
  const bandHeader = getStaging('band_header')!
  it('scrim:"panel" sets support style.panel to the token fill at 0.55 opacity', () => {
    const els = bandHeader.compose(input({ knobs: { scrim: 'panel' } })).elements
    const support = els.find(e => e.id === 'tier_support_0')! as any
    expect(support.style.panel).toEqual({ fill: '{{ brand.background }}', opacity: 0.55 })
  })
  it('scrim:"none" leaves support style.panel unset', () => {
    const els = bandHeader.compose(input({ knobs: { scrim: 'none' } })).elements
    const support = els.find(e => e.id === 'tier_support_0')! as any
    expect(support.style.panel).toBeUndefined()
  })
})

describe('staging: Family C — lockup carries the serif voice (title + date jewel)', () => {
  const lockup = getStaging('lockup')!
  it('hero and anchor default to Playfair Display', () => {
    const els = lockup.compose(input()).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
    expect(hero.style.fontFamily).toBe('Playfair Display')
    expect(anchor.style.fontFamily).toBe('Playfair Display')
  })
  it("an item's own type override still wins over the serif voice default", () => {
    const tiers: Tiers = { ...TIERS, hero: [{ content: 'MAT + FEST', type: { fontFamily: 'Inter' } }] }
    const els = lockup.compose(input({ tiers })).elements
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    expect(hero.style.fontFamily).toBe('Inter')
  })
})

describe('staging: Family C — band geometry scales with the bandSize knob', () => {
  const BAND_SIZES = [0.24, 0.28, 0.34] as const
  it('band_header: band_0 rows [0..bandSize], img_0 rows [bandSize..1], both full width', () => {
    for (const bandSize of BAND_SIZES) {
      const els = getStaging('band_header')!.compose(input({ knobs: { bandSize }, image: IMAGE_TOKEN })).elements
      const band = els.find(e => e.id === 'band_0')!.region
      const img = els.find(e => e.id === 'img_0')!.region
      expect(band.col).toBe(1); expect(band.colSpan).toBe(12)
      expect(band.row).toBe(1)
      expect(img.row).toBe(band.row + band.rowSpan)
      expect(img.row + img.rowSpan - 1).toBe(16)
      expect(img.col).toBe(1); expect(img.colSpan).toBe(12)
    }
  })
  it('band_footer: img_0 rows [0..1-bandSize], band_0 rows [1-bandSize..1], both full width', () => {
    for (const bandSize of BAND_SIZES) {
      const els = getStaging('band_footer')!.compose(input({ knobs: { bandSize }, image: IMAGE_TOKEN })).elements
      const img = els.find(e => e.id === 'img_0')!.region
      const band = els.find(e => e.id === 'band_0')!.region
      expect(img.col).toBe(1); expect(img.colSpan).toBe(12)
      expect(img.row).toBe(1)
      expect(band.row).toBe(img.row + img.rowSpan)
      expect(band.row + band.rowSpan - 1).toBe(16)
      expect(band.col).toBe(1); expect(band.colSpan).toBe(12)
    }
  })
  it('band_header: a bigger bandSize grows the band and shrinks the photo', () => {
    const small = getStaging('band_header')!.compose(input({ knobs: { bandSize: 0.24 }, image: IMAGE_TOKEN })).elements
    const big = getStaging('band_header')!.compose(input({ knobs: { bandSize: 0.34 }, image: IMAGE_TOKEN })).elements
    const bandSmall = small.find(e => e.id === 'band_0')!.region
    const bandBig = big.find(e => e.id === 'band_0')!.region
    const imgSmall = small.find(e => e.id === 'img_0')!.region
    const imgBig = big.find(e => e.id === 'img_0')!.region
    expect(bandBig.rowSpan).toBeGreaterThan(bandSmall.rowSpan)
    expect(imgBig.rowSpan).toBeLessThan(imgSmall.rowSpan)
  })
})

describe('staging: Family C — every text-on-photo/band pair is declared, validates clean', () => {
  for (const id of FIELD_IDS) {
    for (const tiersLabel of ['2/2-item', '1-item'] as const) {
      const tiers = tiersLabel === '1-item' ? ONE_EACH_TIERS : TIERS
      it(`${id}: validates clean with an image — ${tiersLabel}`, () => {
        const result = getStaging(id)!.compose(input({ tiers, image: IMAGE_TOKEN }))
        const { ok, reasons } = validateGenerated(result, 12, 16)
        expect(ok, reasons.join(' ')).toBe(true)
      })
    }
  }
  it('cover: every placed text element (hero, anchor, support x2, fineprint x2) declares an overlap with img_0', () => {
    const result = getStaging('cover')!.compose(input({ image: IMAGE_TOKEN }))
    const textIds = result.elements.filter(e => e.type === 'text').map(e => e.id)
    expect(textIds.length).toBe(6)
    for (const id of textIds) {
      expect(result.overlaps, `${id} not declared against img_0`).toContainEqual([id, 'img_0'])
    }
  })
  it('lockup: every placed text element declares an overlap with img_0', () => {
    const result = getStaging('lockup')!.compose(input({ image: IMAGE_TOKEN }))
    const textIds = result.elements.filter(e => e.type === 'text').map(e => e.id)
    expect(textIds.length).toBe(6)
    for (const id of textIds) {
      expect(result.overlaps, `${id} not declared against img_0`).toContainEqual([id, 'img_0'])
    }
  })
  it('band_header: hero/anchor/fineprint declare overlap with band_0; support declares overlap with img_0', () => {
    const result = getStaging('band_header')!.compose(input({ image: IMAGE_TOKEN }))
    for (const id of ['tier_hero_0', 'tier_anchor_0', 'tier_fineprint_0', 'tier_fineprint_1']) {
      expect(result.overlaps, `${id} not declared against band_0`).toContainEqual([id, 'band_0'])
    }
    for (const id of ['tier_support_0', 'tier_support_1']) {
      expect(result.overlaps, `${id} not declared against img_0`).toContainEqual([id, 'img_0'])
    }
  })
  it('band_footer: hero/anchor/support declare overlap with band_0; fineprint declares overlap with img_0', () => {
    const result = getStaging('band_footer')!.compose(input({ image: IMAGE_TOKEN }))
    for (const id of ['tier_hero_0', 'tier_anchor_0', 'tier_support_0', 'tier_support_1']) {
      expect(result.overlaps, `${id} not declared against band_0`).toContainEqual([id, 'band_0'])
    }
    for (const id of ['tier_fineprint_0', 'tier_fineprint_1']) {
      expect(result.overlaps, `${id} not declared against img_0`).toContainEqual([id, 'img_0'])
    }
  })
})

describe('staging: Family C — z-order: photo/band first (back), text last (front)', () => {
  for (const id of ['cover', 'lockup'] as const) {
    it(`${id}: img_0 precedes every text element`, () => {
      const els = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements
      const imgIndex = els.findIndex(e => e.id === 'img_0')
      expect(imgIndex).toBe(0)
      const firstTextIndex = els.findIndex(e => e.type === 'text')
      expect(imgIndex).toBeLessThan(firstTextIndex)
    })
  }
  for (const id of BAND_IDS) {
    it(`${id}: band_0 (and img_0, when present) precede every text element`, () => {
      const els = getStaging(id)!.compose(input({ image: IMAGE_TOKEN })).elements
      const bandIndex = els.findIndex(e => e.id === 'band_0')
      const imgIndex = els.findIndex(e => e.id === 'img_0')
      const firstTextIndex = els.findIndex(e => e.type === 'text')
      expect(bandIndex).toBeGreaterThanOrEqual(0)
      expect(imgIndex).toBeGreaterThanOrEqual(0)
      expect(bandIndex).toBeLessThan(firstTextIndex)
      expect(imgIndex).toBeLessThan(firstTextIndex)
    })
  }
})

describe('staging: Family C — determinism', () => {
  for (const id of FIELD_IDS) {
    it(`${id}: identical seed produces identical output, with and without an image`, () => {
      const s = getStaging(id)!
      expect(s.compose(input({ rng: makeRng(3) })).elements)
        .toEqual(s.compose(input({ rng: makeRng(3) })).elements)
      expect(s.compose(input({ rng: makeRng(3), image: IMAGE_TOKEN })).elements)
        .toEqual(s.compose(input({ rng: makeRng(3), image: IMAGE_TOKEN })).elements)
    })
  }
})

// NEGATIVE CONTROLS (carried forward from Task 3's review): declared overlaps
// are only meaningful if the validator actually rejects the SAME composition
// once they're stripped — proving the collision check is real, not vacuous.
// Required for `frame` (Family B, round-2b Task 3) and `cover` (Family C,
// this task).
describe('staging: NEGATIVE CONTROL — stripping declared overlaps flips the validator to ok:false', () => {
  it('frame: stripping overlaps makes validateGenerated reject, naming the (tier_hero_0, img_0) collision', () => {
    const result = getStaging('frame')!.compose(input({ image: IMAGE_TOKEN }))
    expect(result.overlaps).toEqual([['tier_hero_0', 'img_0']]) // sanity: declaration exists
    const stripped = { ...result, overlaps: [] }
    const { ok, reasons } = validateGenerated(stripped, 12, 16)
    expect(ok).toBe(false)
    expect(reasons.some(r => r.includes('tier_hero_0') && r.includes('img_0'))).toBe(true)
  })
  it('cover: stripping overlaps makes validateGenerated reject, naming EVERY text/img_0 collision', () => {
    const result = getStaging('cover')!.compose(input({ image: IMAGE_TOKEN }))
    const textIds = result.elements.filter(e => e.type === 'text').map(e => e.id)
    expect(textIds.length).toBeGreaterThan(0) // sanity: there's something to collide
    expect(result.overlaps!.length).toBe(textIds.length) // sanity: every one was declared
    const stripped = { ...result, overlaps: [] }
    const { ok, reasons } = validateGenerated(stripped, 12, 16)
    expect(ok).toBe(false)
    for (const id of textIds) {
      expect(reasons.some(r => r.includes(id) && r.includes('img_0')), `no collision reason named ${id}`).toBe(true)
    }
  })
})
