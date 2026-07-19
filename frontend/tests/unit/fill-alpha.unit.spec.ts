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
// This is a source-text scan, not a runtime check, so it can't know which identifiers actually
// hold an unstripped colour. A plain "does the argument text mention params./p./Color" heuristic
// has a proven false-negative: a colour stashed in a short/abbreviated local (`strokeCol`, `tc`,
// `darkHex`, ...) doesn't textually mention any of those, so the naive trigger goes blind at
// exactly the point where a `.set(strokeCol)` call is otherwise indistinguishable from a safe one.
// This was NOT hypothetical — `contour.ts`/`tunnel.ts` (`strokeCol`) and `streamer.ts` (`tc`) all
// shipped the unstripped-alpha bug past the naive scan; only a manual trace caught them.
//
// So this scan does a (deliberately lightweight, regex-based — not a full AST parse) local taint
// propagation per file:
//   - an identifier is TAINTED if its `const`/`let` initializer references `params.`/`p.`, is a hex
//     string literal, or references another tainted identifier — iterated to a fixed point so
//     taint flows through short alias chains (`const a = params.x; const b = a; ... .set(b)`).
//   - an identifier is SAFE if its initializer already routes through `stripAlpha`/`fillPrimary`/
//     `fillTextColor` — that neutralizes taint even though the initializer *also* mentions
//     `params.` (e.g. `const strokeCol = stripAlpha(String(params.strokeColor ?? '#000'))`).
// A THREE.Color construction/mutation is then flagged when its argument text is tainted — either
// directly (mentions params./p./Color, same as before) or via a tainted local — and is not itself
// wrapped in stripAlpha/fillPrimary/fillTextColor and does not reference a SAFE local.
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
const HEX_LITERAL = /['"`]#[0-9a-fA-F]{3,8}['"`]/
// `const`/`let` NAME [: Type] = INIT — INIT stops at `;`/newline. A deliberately simple,
// single-line binding shape; multi-line initializers or destructuring fall outside it, which is
// fine for a heuristic that just needs a couple of fixed-point passes over real-world code.
const DECL_RE = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([^;\n]+)/g
const SPACETYPE_DIR = new URL('../../app/lib/spacetype/', import.meta.url).pathname

function refsIdent(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(text)
}

/** Local taint propagation for one file's source: which locals hold an unstripped colour
 *  (TAINTED) vs. which locals already had alpha stripped (SAFE). */
function scanLocals(src: string): { tainted: Set<string>; safe: Set<string> } {
  const decls: Array<{ name: string; init: string }> = []
  const re = new RegExp(DECL_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) decls.push({ name: m[1]!, init: m[2]!.trim() })

  const tainted = new Set<string>()
  const safe = new Set<string>()
  // Fixed point over alias chains (a → b → c). Real code is a handful of hops deep at most.
  for (let pass = 0; pass < 5; pass++) {
    for (const { name, init } of decls) {
      if (safe.has(name) || tainted.has(name)) continue
      if (COLOR_SAFE.test(init)) { safe.add(name); continue }
      const fromParams = /params\.|\bp\./.test(init)
      const fromHexLiteral = HEX_LITERAL.test(init)
      const fromTainted = [...tainted].some(t => refsIdent(init, t))
      if (fromParams || fromHexLiteral || fromTainted) tainted.add(name)
    }
  }
  return { tainted, safe }
}

/** Is `arg` (the text passed to a Color ctor/.set()/.setStyle()/.setHex()) an unstripped colour,
 *  given this file's local taint map? */
function isUnstrippedColorArg(arg: string, locals: { tainted: Set<string>; safe: Set<string> }): boolean {
  if (COLOR_SAFE.test(arg)) return false
  if ([...locals.safe].some(s => refsIdent(arg, s))) return false
  if (COLOR_TRIGGER.test(arg)) return true
  return [...locals.tainted].some(t => refsIdent(arg, t))
}

describe('THREE.Color alpha safety (static scan)', () => {
  const files = walkTsFiles(SPACETYPE_DIR)
  // Guards against the scan passing vacuously (e.g. a directory-walk regression that silently
  // returns nothing, or a rename that moves the scanned tree out from under SPACETYPE_DIR). Floors
  // are well below the current real counts (59 files / 36 ctor sites / 15 .set() sites) — only a
  // broken walk trips them.
  const FILE_FLOOR = 20
  const SITE_FLOOR = 10

  it('scanned a non-trivial number of spacetype source files', () => {
    expect(files.length).toBeGreaterThan(FILE_FLOOR)
  })

  it('never constructs a THREE.Color from an unstripped params colour', () => {
    const offenders: string[] = []
    let sites = 0
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const locals = scanLocals(src)
      const re = /new\s+(?:three|THREE)\.Color\(\s*([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        sites++
        const arg = m[1]!
        if (isUnstrippedColorArg(arg, locals)) {
          offenders.push(`${f.replace(SPACETYPE_DIR, '')}: new Color(${arg.trim()})`)
        }
      }
    }
    expect(sites).toBeGreaterThan(SITE_FLOOR)
    expect(offenders).toEqual([])
  })

  it('never .set()s a THREE.Color uniform/material colour from an unstripped params colour', () => {
    const offenders: string[] = []
    let sites = 0
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      const locals = scanLocals(src)
      // Scoped to the three receiver shapes this codebase uses for a THREE.Color mutation: a
      // shader uniform's `.value`, a value already narrowed `as THREE.Color`/`as three.Color`, or
      // a material's `.color`. Deliberately NOT a bare `.set(` — that also matches Vector2/3,
      // Euler and Map (position.set(x,y,z), cache.set(key, val)), which would make this vacuous.
      const re = /(?:\.value|value\s+as\s+(?:THREE|three)\.Color\)|\.color)\.set(?:Style)?\(\s*([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        sites++
        const arg = m[1]!
        if (isUnstrippedColorArg(arg, locals)) {
          offenders.push(`${f.replace(SPACETYPE_DIR, '')}: .set(${arg.trim()})`)
        }
      }
    }
    expect(sites).toBeGreaterThan(SITE_FLOOR)
    expect(offenders).toEqual([])
  })
})
