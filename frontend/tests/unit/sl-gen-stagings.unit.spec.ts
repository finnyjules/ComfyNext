import { describe, it, expect } from 'vitest'
import { STAGINGS, getStaging, type StagingInput } from '~~/shared/template-grid/generate/stagings'
import { makeRng } from '~~/shared/template-grid/generate/rng'
import type { Tiers } from '~~/shared/template-grid/types'

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

describe('staging: tower', () => {
  const tower = getStaging('tower')!
  it('is registered', () => { expect(tower).toBeTruthy() })
  it('places one element per enabled tier item, tagged staging origin', () => {
    const els = tower.compose(input())
    // 1 hero + 1 anchor + 2 support + 2 fineprint
    expect(els).toHaveLength(6)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('carries each tier content through', () => {
    const els = tower.compose(input())
    expect(els.map(e => (e as any).content)).toContain('MAT + FEST')
    expect(els.map(e => (e as any).content)).toContain('Slakthus · Hall 3')
    expect(els.map(e => (e as any).content)).toContain('Live music · Market')
    expect(els.map(e => (e as any).content)).toContain('Free entry · All ages')
  })
  it('gives the hero the largest type level', () => {
    const els = tower.compose(input())
    const hero = els.find(e => e.id === 'tier_hero_0')! as any
    const fine = els.find(e => e.id === 'tier_fineprint_0')! as any
    expect(LEVELS.indexOf(hero.level)).toBeGreaterThan(LEVELS.indexOf(fine.level))
  })
  it('keeps every region inside the grid', () => {
    for (const e of tower.compose(input())) {
      expect(e.region.col).toBeGreaterThanOrEqual(1)
      expect(e.region.col + e.region.colSpan - 1).toBeLessThanOrEqual(12)
      expect(e.region.row).toBeGreaterThanOrEqual(1)
      expect(e.region.row + e.region.rowSpan - 1).toBeLessThanOrEqual(16)
    }
  })
  it('is deterministic per seed', () => {
    expect(tower.compose(input({ rng: makeRng(3) }))).toEqual(tower.compose(input({ rng: makeRng(3) })))
  })
})

describe('staging: split + frame registered and valid', () => {
  for (const id of ['split', 'frame']) {
    it(`${id} places tiers inside the grid with hero largest`, () => {
      const s = getStaging(id)!
      expect(s).toBeTruthy()
      const els = s.compose(input())
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
    const t = getStaging('tower')!.compose(input())
    const s = getStaging('split')!.compose(input())
    expect(JSON.stringify(s.map(e => e.region))).not.toBe(JSON.stringify(t.map(e => e.region)))
  })
})

describe('staging: full library', () => {
  it('registers all six stagings', () => {
    expect(STAGINGS.map(s => s.id).sort()).toEqual(
      ['centered', 'editorial', 'frame', 'index', 'split', 'tower'])
  })
  it('every staging produces distinct placement and stays in-grid', () => {
    const shapes = new Set<string>()
    for (const s of STAGINGS) {
      const els = s.compose(input())
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
  function overlaps(a: { col: number; row: number; colSpan: number; rowSpan: number },
                     b: { col: number; row: number; colSpan: number; rowSpan: number }) {
    const ax2 = a.col + a.colSpan - 1, ay2 = a.row + a.rowSpan - 1
    const bx2 = b.col + b.colSpan - 1, by2 = b.row + b.rowSpan - 1
    return a.col <= bx2 && b.col <= ax2 && a.row <= by2 && b.row <= ay2
  }
  for (const s of STAGINGS) {
    it(`${s.id}: no two elements share a grid cell under default knobs`, () => {
      const els = s.compose(input())
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i]!, b = els[j]!
          expect(overlaps(a.region, b.region),
            `${a.id} (${JSON.stringify(a.region)}) overlaps ${b.id} (${JSON.stringify(b.region)})`)
            .toBe(false)
        }
      }
    })
  }
})

describe('staging: tier lists — every item renders, nothing dropped', () => {
  for (const s of STAGINGS) {
    it(`${s.id}: renders both support items at distinct regions`, () => {
      const els = s.compose(input())
      const s0 = els.find(e => e.id === 'tier_support_0') as any
      const s1 = els.find(e => e.id === 'tier_support_1') as any
      expect(s0, `${s.id} missing tier_support_0`).toBeTruthy()
      expect(s1, `${s.id} missing tier_support_1`).toBeTruthy()
      expect(s0.region).not.toEqual(s1.region)
      expect(s0.content).toBe('Street food · Dining')
      expect(s1.content).toBe('Live music · Market')
    })
    it(`${s.id}: renders both fineprint items at distinct regions`, () => {
      const els = s.compose(input())
      const f0 = els.find(e => e.id === 'tier_fineprint_0') as any
      const f1 = els.find(e => e.id === 'tier_fineprint_1') as any
      expect(f0, `${s.id} missing tier_fineprint_0`).toBeTruthy()
      expect(f1, `${s.id} missing tier_fineprint_1`).toBeTruthy()
      expect(f0.region).not.toEqual(f1.region)
      expect(f0.content).toBe('Slakthus · Hall 3')
      expect(f1.content).toBe('Free entry · All ages')
    })
  }

  it('tower: a single support item keeps the round-1 generous rowSpan (2), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('tower')!.compose(input({ tiers: tiersWithOneSupport }))
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(2)
  })

  it('split: a single support item keeps the round-1 generous rowSpan (3), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('split')!.compose(input({ tiers: tiersWithOneSupport }))
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(3)
  })

  it('editorial: a single support item keeps the round-1 generous rowSpan (4), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('editorial')!.compose(input({ tiers: tiersWithOneSupport }))
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(4)
  })

  it('index: a single support item keeps the round-1 generous rowSpan (3), not the 2-item compact one', () => {
    const tiersWithOneSupport: Tiers = { ...TIERS, support: [{ content: 'Street food · Dining' }] }
    const els = getStaging('index')!.compose(input({ tiers: tiersWithOneSupport }))
    const support0 = els.find(e => e.id === 'tier_support_0')! as any
    expect(support0.region.rowSpan).toBe(3)
  })

  it('disabled item 0 with a valid item 1 renders the valid item (filtered list is the source of truth)', () => {
    const tiersWithDisabledHero: Tiers = {
      ...TIERS,
      hero: [{ content: 'DISABLED HERO', enabled: false }, { content: 'REAL HERO' }],
    }
    const tower = getStaging('tower')!
    const els = tower.compose(input({ tiers: tiersWithDisabledHero }))
    const hero = els.find(e => e.id === 'tier_hero_0') as any
    expect(hero).toBeTruthy()
    expect(hero.content).toBe('REAL HERO')
    expect(els.some(e => (e as any).content === 'DISABLED HERO')).toBe(false)
  })
})

describe('staging: dramatic hero + anchor type', () => {
  for (const s of STAGINGS) {
    it(`${s.id}: hero fontSize follows the heroScale knob × canvas.h`, () => {
      for (const heroScale of HERO_SCALES) {
        const els = s.compose(input({ knobs: { heroScale } }))
        const hero = els.find(e => e.id === 'tier_hero_0')! as any
        expect(hero.style.fontSize).toBe(Math.round(heroScale * CANVAS.h))
      }
    })
    it(`${s.id}: hero has tight lineHeight and negative letterSpacing`, () => {
      const els = s.compose(input())
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      expect(hero.style.lineHeight).toBe(0.92)
      expect(hero.style.letterSpacing).toBeLessThan(0)
    })
    it(`${s.id}: anchor fontSize tracks 0.45 × hero fontSize`, () => {
      const els = s.compose(input())
      const hero = els.find(e => e.id === 'tier_hero_0')! as any
      const anchor = els.find(e => e.id === 'tier_anchor_0')! as any
      expect(Math.abs(anchor.style.fontSize - Math.round(0.45 * hero.style.fontSize))).toBeLessThanOrEqual(1)
      expect(anchor.style.letterSpacing).toBeLessThan(0)
    })
  }
})
