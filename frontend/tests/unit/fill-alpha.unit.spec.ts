import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fillPrimary, fillAlpha, fillTextColor, fillTextAlpha } from '~/lib/spacetype/fills'
import { hexBytes, DEFAULT_FILL, type Fill } from '~/lib/spacetype/fillTile'

const solid = (a: string): Fill => ({ ...DEFAULT_FILL, type: 'solid', a })

describe('fillAlpha', () => {
  it('is 1 for a legacy 6-digit fill', () => {
    expect(fillAlpha(solid('#ff0000'))).toBe(1)
  })
  it('reads alpha from an 8-digit fill', () => {
    expect(fillAlpha(solid('#ff000000'))).toBe(0)
    expect(fillAlpha(solid('#ff000080'))).toBeCloseTo(0.502, 3)
  })
})

describe('fillPrimary', () => {
  it('ignores alpha and returns the rgb — THREE.Color renders 8-digit hex as black', () => {
    const withA = fillPrimary(THREE, solid('#ff000080'))
    const without = fillPrimary(THREE, solid('#ff0000'))
    expect(withA.getHex()).toBe(without.getHex())
    expect(withA.getHex()).toBe(0xff0000)
  })
})

describe('hexBytes', () => {
  it('returns rgb bytes for 8-digit input rather than falling back to black', () => {
    expect(Array.from(hexBytes('#ff000080')).slice(0, 3)).toEqual([255, 0, 0])
  })
})

describe('fillTextColor', () => {
  it('ignores alpha and returns the rgb — THREE.Color renders 8-digit hex as white', () => {
    const withA = fillTextColor(THREE, { ...DEFAULT_FILL, textColor: '#ff000080' })
    const without = fillTextColor(THREE, { ...DEFAULT_FILL, textColor: '#ff0000' })
    expect(withA.getHex()).toBe(without.getHex())
    expect(withA.getHex()).toBe(0xff0000)
  })
})

describe('fillTextAlpha', () => {
  it('is 1 for a legacy 6-digit textColor', () => {
    expect(fillTextAlpha({ ...DEFAULT_FILL, textColor: '#ff0000' })).toBe(1)
  })
  it('reads alpha from an 8-digit textColor', () => {
    expect(fillTextAlpha({ ...DEFAULT_FILL, textColor: '#ff000080' })).toBeCloseTo(0.502, 3)
  })
})

// ── Static invariant: no THREE.Color ever built/mutated from an unstripped params colour ──────
//
// THREE.Color has no alpha channel and cannot parse 8-digit hex — given one it does NOT throw, it
// warns to the console and silently resolves to white. 8-digit hex (#rrggbbaa) is the storage
// format for Space Type colours once alpha is involved, so every `kind: 'color'` ControlSpec param
// can carry one. A control whose effect doesn't implement transparency must still render OPAQUE
// (correct RGB, alpha dropped) — never white. `stripAlpha` (~/lib/color/convert) is the fix; this
// test locks the invariant structurally instead of enumerating today's call sites, so a future
// effect (or a future edit to an existing one) can't reintroduce the bug unnoticed.
//
// This is a source-text scan, not a runtime check: it does not know which identifiers actually
// hold an unstripped colour, so it uses a naming heuristic — flag an argument only when it
// plausibly traces back to a colour param: `params.foo`, `p.foo` (the ControlSpec params bag), or
// any identifier containing the word "Color" (uTextColor, cardColor, o.strokeColor, ...), which is
// the naming convention every colour-carrying value in this codebase follows. A hit is excluded if
// the argument already routes through `stripAlpha`/`fillPrimary`/`fillTextColor`.
function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTsFiles(p))
    else if (entry.name.endsWith('.ts')) out.push(p)
  }
  return out
}

const COLOR_SAFE = /stripAlpha|fillPrimary|fillTextColor/
const COLOR_TRIGGER = /params\.|\bp\.|Color\b/
const SPACETYPE_DIR = new URL('../../app/lib/spacetype/', import.meta.url).pathname

describe('THREE.Color alpha safety (static scan)', () => {
  it('never constructs a THREE.Color from an unstripped params colour', () => {
    const offenders: string[] = []
    for (const f of walkTsFiles(SPACETYPE_DIR)) {
      const src = readFileSync(f, 'utf8')
      const re = /new\s+(?:three|THREE)\.Color\(\s*([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const arg = m[1]!
        if (COLOR_TRIGGER.test(arg) && !COLOR_SAFE.test(arg)) {
          offenders.push(`${f.replace(SPACETYPE_DIR, '')}: new Color(${arg.trim()})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never .set()s a THREE.Color uniform/material colour from an unstripped params colour', () => {
    const offenders: string[] = []
    for (const f of walkTsFiles(SPACETYPE_DIR)) {
      const src = readFileSync(f, 'utf8')
      // Scoped to the three receiver shapes this codebase uses for a THREE.Color mutation: a
      // shader uniform's `.value`, a value already narrowed `as THREE.Color`/`as three.Color`, or
      // a material's `.color`. Deliberately NOT a bare `.set(` — that also matches Vector2/3,
      // Euler and Map (position.set(x,y,z), cache.set(key, val)), which would make this vacuous.
      const re = /(?:\.value|value\s+as\s+(?:THREE|three)\.Color\)|\.color)\.set(?:Style)?\(\s*([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const arg = m[1]!
        if (COLOR_TRIGGER.test(arg) && !COLOR_SAFE.test(arg)) {
          offenders.push(`${f.replace(SPACETYPE_DIR, '')}: .set(${arg.trim()})`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
