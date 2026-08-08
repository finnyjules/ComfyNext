import { describe, it, expect } from 'vitest'
import { STAGINGS, getStaging, type StagingInput } from '~~/shared/template-grid/generate/stagings'
import { makeRng } from '~~/shared/template-grid/generate/rng'
import type { Tiers } from '~~/shared/template-grid/types'

const LEVELS = ['caption', 'body', 'subhead', 'headline', 'display']
const TIERS: Tiers = {
  hero: { content: 'MAT + FEST' },
  anchor: { content: '15—26 June' },
  support: { content: 'Street food · Dining' },
  fineprint: { content: 'Slakthus · Hall 3' },
}
function input(over: Partial<StagingInput> = {}): StagingInput {
  return { tiers: TIERS, cols: 12, rows: 16, rng: makeRng(1), knobs: {}, ...over }
}

describe('staging: tower', () => {
  const tower = getStaging('tower')!
  it('is registered', () => { expect(tower).toBeTruthy() })
  it('places one element per enabled tier, tagged staging origin', () => {
    const els = tower.compose(input())
    expect(els).toHaveLength(4)
    expect(els.every(e => e.origin === 'staging')).toBe(true)
  })
  it('carries each tier content through', () => {
    const els = tower.compose(input())
    expect(els.map(e => (e as any).content)).toContain('MAT + FEST')
    expect(els.map(e => (e as any).content)).toContain('Slakthus · Hall 3')
  })
  it('gives the hero the largest type level', () => {
    const els = tower.compose(input())
    const hero = els.find(e => e.id === 'tier_hero')! as any
    const fine = els.find(e => e.id === 'tier_fineprint')! as any
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
  const LEVELS = ['caption', 'body', 'subhead', 'headline', 'display']
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
      const hero = els.find(e => e.id === 'tier_hero')! as any
      const fine = els.find(e => e.id === 'tier_fineprint')! as any
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
