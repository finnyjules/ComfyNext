/**
 * Vector Type Studio — WORD GROUPING. PURE.
 *
 * Imports nothing but a type. No canvas, no DOM, no fontkit, no `fetch`.
 *
 * ## There is no word in this studio
 *
 * Everything downstream of `outline.ts` is glyphs all the way down. There is no
 * `splitLevel` like the old kinetic catalog had, and no unit between "one glyph"
 * and "the whole run". Blink wants one (`unit: 'letter' | 'word'`), so a word has
 * to be defined — and the point of this module is that it is defined **here,
 * once, with reasons**, rather than discovered inside a renderer as an
 * `if (codePoint === 32)`.
 *
 * The input is the glyph run, not the source string, and that is deliberate.
 * Shaping is the font's: ligatures merge several code points into one glyph, and
 * the indices a renderer transforms are glyph indices, not character indices. A
 * word defined over the source string would be off by one from the thing being
 * animated the first time a font ligated `ffi`. `GlyphOutline.codePoints` is the
 * bridge — fontkit reports which code points each shaped glyph came from — so
 * this reads the run the renderer actually draws.
 *
 * ## What separates a word: whitespace, and only whitespace
 *
 * Four decisions, each taken because the alternative looks wrong on screen:
 *
 * **Punctuation does not separate.** `"Hello, world!"` is two words, `"Hello,"`
 * and `"world!"`. A comma has no gap before it — it is optically part of the
 * word it trails. Blinking a word off and leaving its comma hanging in mid-air
 * reads as a bug, not as an effect.
 *
 * **Hyphens do not separate.** `"state-of-the-art"` is one word. Same argument,
 * more strongly: a hyphen sits on the baseline between two letters with no gap
 * either side, so a split there leaves dangling hyphens. The dash that *does*
 * read as a separator — `"a — b"` — is spaced in practice, and the spaces
 * separate it. So the rule needs no dash special case.
 *
 * **A run with no whitespace is one word.** Falling back to "every glyph is its
 * own word" would make `unit: 'word'` silently identical to `unit: 'letter'` on
 * a one-word headline, which is most headlines in this studio.
 *
 * **Non-breaking spaces do not separate.** U+00A0 and U+202F exist precisely to
 * say "these two parts must stay together" — `"10 kg"`, `"Fig. 4"`. Someone who
 * typed one asked for exactly the binding a word unit provides, so honouring it
 * is the whole reason the character exists. This is the one place the rule is
 * not simply "is it blank", and it is worth the exception.
 *
 * Empty runs, all-space runs, leading and trailing spaces, and repeated spaces
 * all produce no empty words: a word group is never empty, and separator glyphs
 * belong to no word at all.
 */

/** The shape this module needs from a glyph. Structurally a subset of
 *  `GlyphOutline`, declared locally so word grouping never has to import the
 *  outline module — and so a test can group a run without a font. */
export interface VtWordGlyph {
  /** The code points this glyph came from. A ligature carries several; some
   *  substitutions report none. */
  codePoints: readonly number[]
}

/** One word: a contiguous run of glyph indices with no whitespace inside it. */
export interface VtWordGroup {
  /** Glyph indices, ascending and contiguous. Never empty. */
  glyphs: number[]
  /** First glyph index in the word. */
  start: number
  /** Last glyph index in the word, INCLUSIVE. */
  end: number
}

/** A glyph that belongs to no word — the separators themselves. */
export const VT_NO_WORD = -1

/**
 * Is this code point a word separator?
 *
 * Unicode's whitespace, minus the non-breaking members, plus U+200B.
 *
 *  - U+0009..U+000D, U+0020, U+0085 — the ASCII/C1 blanks and line breaks.
 *  - U+1680, U+2000..U+200A, U+2028, U+2029, U+205F, U+3000 — the typographic
 *    and ideographic spaces.
 *  - **U+200B ZERO WIDTH SPACE separates.** It carries no ink and exists solely
 *    to mark a break opportunity, so it is a separator that happens to be
 *    invisible — which is exactly what a word boundary is.
 *  - **U+00A0 NBSP and U+202F NARROW NBSP do NOT separate** (see the header).
 *  - **U+200C ZWNJ and U+200D ZWJ do NOT separate.** They are joiners: they
 *    control shaping *within* a word (and build emoji sequences). Treating a
 *    joiner as a break would be backwards.
 */
export function isWordSeparator(codePoint: number): boolean {
  const c = codePoint | 0
  if (c === 0x0020) return true                     // SPACE
  if (c >= 0x0009 && c <= 0x000d) return true       // TAB, LF, VT, FF, CR
  if (c === 0x0085) return true                     // NEL
  if (c === 0x1680) return true                     // OGHAM SPACE MARK
  if (c >= 0x2000 && c <= 0x200a) return true       // EN QUAD … HAIR SPACE
  if (c === 0x200b) return true                     // ZERO WIDTH SPACE
  if (c === 0x2028 || c === 0x2029) return true     // LINE / PARAGRAPH SEPARATOR
  if (c === 0x205f) return true                     // MEDIUM MATHEMATICAL SPACE
  if (c === 0x3000) return true                     // IDEOGRAPHIC SPACE
  return false                                      // incl. 0x00a0, 0x202f, 0x200c, 0x200d
}

/**
 * Is this shaped glyph a separator?
 *
 * A glyph is a separator only when **every** code point it carries is one. The
 * asymmetry is on purpose and it matters for ligatures: a glyph carrying `['a',
 * ' ']` has ink in it, and dropping it out of the word would leave a hole. Any
 * ink at all means the glyph belongs to the word.
 *
 * A glyph reporting **no** code points is likewise not a separator. fontkit can
 * produce these for some substitutions, and the safe default for unknown
 * provenance is "part of the word": including one glyph too many in a word
 * blinks a slightly larger group, whereas excluding one leaves a stray mark
 * behind on screen.
 */
export function isSeparatorGlyph(glyph: VtWordGlyph | null | undefined): boolean {
  const cps = glyph?.codePoints
  if (!Array.isArray(cps) || cps.length === 0) return false
  for (const c of cps) {
    if (!Number.isFinite(c) || !isWordSeparator(c)) return false
  }
  return true
}

/**
 * Split a shaped glyph run into words.
 *
 * Words come back in run order, each one a contiguous ascending block of glyph
 * indices. Separator glyphs appear in no group, so
 * `sum(w.glyphs.length) + separators === glyphs.length`, and no group is ever
 * empty — repeated, leading and trailing spaces simply never open one.
 */
export function groupWords(glyphs: readonly VtWordGlyph[] | null | undefined): VtWordGroup[] {
  const run = Array.isArray(glyphs) ? glyphs : []
  const words: VtWordGroup[] = []
  let current: number[] | null = null

  for (let i = 0; i < run.length; i++) {
    if (isSeparatorGlyph(run[i])) {
      current = null
      continue
    }
    if (!current) {
      current = [i]
      words.push({ glyphs: current, start: i, end: i })
    } else {
      current.push(i)
      words[words.length - 1]!.end = i
    }
  }

  return words
}

/**
 * Which word each glyph belongs to, parallel to the run.
 *
 * The lookup a renderer actually wants: it loops over glyph indices, so it needs
 * `wordOf[i]`, not a search through the groups. Separators get `VT_NO_WORD`
 * (`-1`), which keeps them out of every effect by construction — a space cannot
 * blink, and a caller that forgets to check will index an array with `-1` and
 * get `undefined` rather than silently dimming word 0.
 */
export function wordIndexOfGlyph(glyphs: readonly VtWordGlyph[] | null | undefined): number[] {
  const run = Array.isArray(glyphs) ? glyphs : []
  const out = new Array<number>(run.length).fill(VT_NO_WORD)
  const words = groupWords(run)
  for (let w = 0; w < words.length; w++) {
    for (const i of words[w]!.glyphs) out[i] = w
  }
  return out
}

/** How many words the run holds. `0` for an empty or all-whitespace run. */
export function wordCount(glyphs: readonly VtWordGlyph[] | null | undefined): number {
  return groupWords(glyphs).length
}
