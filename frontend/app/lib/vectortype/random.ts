/**
 * Vector Type Studio — SEEDED PER-GLYPH RANDOMNESS. PURE.
 *
 * Numbers in, numbers out. No canvas, no DOM, no `fetch`, no fontkit, no paper —
 * this module imports nothing at all, the same bar `curve.ts` holds itself to.
 *
 * ## Why this is a module and not three inline `Math.random()` calls
 *
 * Blink, per-glyph axis scatter and grade flicker are the same thing wearing
 * three hats: **one seeded per-glyph random number driving a different target**
 * (opacity, an axis coordinate, `GRAD`). Built once here, each of them is thin.
 *
 * The reason it has to be seeded is the studio's whole promise:
 *
 *   **The same `(glyph, t)` must produce the same value in the browser preview,
 *   the PNG bake, the video bake and the SVG export.**
 *
 * `Math.random()` breaks that in a way that *looks fine*: the preview flickers
 * convincingly, the bake flickers convincingly, and they flicker differently.
 * The stagger already met this — its `random` order is a seeded shuffle for
 * exactly this reason, and its comment says so ("Integer maths only — no floats,
 * no `Math.random()`"). `hash32` below is that function, moved here so the two
 * uses share one implementation rather than drifting apart; `motion.ts` now
 * imports it. Its arithmetic is untouched, and
 * `tests/unit/vectortype-random.unit.spec.ts` pins both its raw outputs and the
 * stagger ranks it feeds to golden values so a future edit cannot quietly
 * reshuffle every saved animation.
 *
 * ## Time enters as a BUCKET, never as a roll
 *
 * Blink is *literally* per-frame randomness, which is the trap. The resolution
 * is that time is quantised before it reaches the hash:
 *
 *   `glyphRandom(i, seed, 'blink', timeBucket(t, period))`
 *
 * `floor(t / period)` is a pure function of `t`, so two renderers evaluating the
 * same `t` land in the same bucket and draw the same frame. Nothing here holds
 * state, so there is no "next" value to get out of step — call order, frame rate
 * and render count are all irrelevant.
 *
 * The one residual sharp edge, stated rather than hidden: `t` values either side
 * of a bucket edge land in different buckets. A preview at `t = 0.99999` and a
 * bake at `t = 1.0` legitimately differ, because they are different times. That
 * is a property of quantisation, not of this module; callers comparing a bake to
 * a preview must compare the *same* `t`.
 *
 * ## Channels
 *
 * `channel` is not decoration. Two effects reading the same source on the same
 * glyph correlate **perfectly** — the letter that blinks off is the letter that
 * scatters furthest, on every word, every time, and the composite reads as one
 * effect rather than two. A channel is an independent stream over the same
 * glyphs. The spec measures this: shared channel r = 1.000, separate channels
 * r ≈ 0.
 */

/** Domain salt. Folded into the seed so the all-zero input cannot collapse.
 *
 *  `hash32(0, 0) === 0` — the avalanche has no key material to work on when both
 *  inputs are zero, and every later round of a chain fed by it stays zero too.
 *  Glyph 0 of a default-seeded run at bucket 0 is the single most likely call
 *  this module will ever receive, so a stuck 0 there would be a permanently dark
 *  first letter that no seed change fixes. The salt is an arbitrary odd 32-bit
 *  constant; its only job is to be non-zero. */
const VT_RANDOM_SALT = 0x5bf03635 | 0

/**
 * A 32-bit avalanche hash of `(index, seed)`, returned unsigned.
 *
 * Integer maths only — no floats, no `Math.random()`, no module-level mutable
 * RNG state — so the same inputs give the same bits in the browser preview, the
 * headless bake and the SVG export.
 *
 * Moved here verbatim from `motion.ts`, which now imports it. The stagger's
 * `random` order depends on its exact outputs (they decide who leads a word), so
 * the arithmetic is frozen: change a constant and every saved animation using
 * `order: 'random'` reshuffles.
 */
export function hash32(index: number, seed: number): number {
  let h = (index | 0) ^ Math.imul(seed | 0, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  return (h ^ (h >>> 15)) >>> 0
}

/** Any label may name a channel. Strings read at the call site (`'blink'`,
 *  `'scatter'`, `'grade'`); numbers are for generated channels — a per-axis
 *  scatter wanting one stream per axis can pass the axis's ordinal. */
export type VtRandomChannel = string | number

/**
 * Fold a channel label down to a 32-bit key.
 *
 * FNV-1a over UTF-16 code units, then one avalanche round.
 *
 * **The avalanche round is not load-bearing, and the measurement says so.** The
 * tempting story is that raw FNV leaves near-neighbour labels near-neighbours in
 * key space (`'axis0'` and `'axis1'` differ by exactly the FNV prime, 16777619)
 * and that feeding two adjacent keys in would correlate the channels. It does
 * not: with raw FNV keys, `'axis0'` against `'axis1'` measures r = 0.0023 — if
 * anything *lower* than the mixed version's −0.0074, both being noise. The
 * reason is that round 1 of `glyphRandom`'s chain already avalanches whatever it
 * is handed, so the key arrives well mixed either way.
 *
 * It is kept for one smaller, honest reason: `channelKey` is exported, so it
 * should be a sound hash standing on its own rather than one that happens to be
 * rescued by its only current caller. It costs one `imul`.
 *
 * Numbers pass through the same round so a numeric channel is mixed the same way
 * as a named one.
 */
export function channelKey(channel: VtRandomChannel): number {
  if (typeof channel === 'number') {
    return hash32(Number.isFinite(channel) ? Math.trunc(channel) : 0, 0x1b873593)
  }
  const s = String(channel ?? '')
  let h = 0x811c9dc5 | 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  }
  return hash32(h, 0x1b873593)
}

/**
 * Which time bucket `t` falls in, for a repeat every `period`.
 *
 * The whole point is that this is a pure function of `t`: quantise, then hash.
 * A non-positive, non-finite or zero `period` means "does not vary with time"
 * and returns a constant 0 — a rate slider dragged to zero should freeze the
 * effect, not divide by zero or make it flicker at the frame rate.
 *
 * Negative `t` is fine and keeps counting down (`floor` handles it); nothing
 * here assumes a forward-only clock.
 */
export function timeBucket(t: number, period: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(period) || period <= 0) return 0
  return Math.floor(t / period)
}

/**
 * A stable random number in `[0, 1)` for one glyph, on one channel, in one time
 * bucket.
 *
 * Three avalanche rounds, chained so that each argument is mixed in with full
 * key material rather than XOR-ed into a shared word:
 *
 *   1. channel + seed  → a stream key
 *   2. bucket          → this instant's key within that stream
 *   3. glyph index     → this glyph's value at that instant
 *
 * Chaining rather than combining matters, and this one IS measured. The obvious
 * shortcut, `hash32(index ^ channelKey ^ bucket, seed)`, is symmetric in `index`
 * and `bucket`: **glyph *i* at bucket *b* gets exactly the value glyph *b* gets
 * at bucket *i*.* Over the first 40×40 glyph/bucket pairs that shortcut aliases
 * 1560 out of 1560 — every single one — where the chained version aliases 0. On
 * screen that is a diagonal crawling through a blink, which reads as a pattern
 * rather than as noise. Chained rounds have no such algebra between arguments.
 *
 * Omit `bucket` (or pass 0) for a value that is constant in time — that is the
 * scatter case, where each glyph settles at its own fixed offset. Pass
 * `timeBucket(t, period)` for the blink and flicker cases.
 *
 * Non-finite arguments are floored to 0 rather than producing `NaN`: a `NaN`
 * opacity paints nothing and a `NaN` axis coordinate silently ignores the whole
 * variation, and both would be invisible bugs at the far end of a slider.
 */
export function glyphRandom(
  index: number,
  seed: number,
  channel: VtRandomChannel,
  bucket = 0,
): number {
  const i = Number.isFinite(index) ? Math.trunc(index) : 0
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0
  const b = Number.isFinite(bucket) ? Math.trunc(bucket) : 0
  const stream = hash32(channelKey(channel), s ^ VT_RANDOM_SALT)
  const instant = hash32(b, stream)
  return hash32(i, instant) / 4294967296
}

/**
 * `glyphRandom` mapped onto `[min, max)`.
 *
 * A convenience with one real job: it is the only place that decides what a
 * reversed range means. `randomRange(i, s, c, 10, 2)` returns a value between 2
 * and 10 rather than an empty range or a NaN, because a spread control that a
 * user drags past its base should scatter the other way, not stop working.
 */
export function glyphRandomRange(
  index: number,
  seed: number,
  channel: VtRandomChannel,
  min: number,
  max: number,
  bucket = 0,
): number {
  const lo = Number.isFinite(min) ? min : 0
  const hi = Number.isFinite(max) ? max : 0
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  return a + glyphRandom(index, seed, channel, bucket) * (b - a)
}
