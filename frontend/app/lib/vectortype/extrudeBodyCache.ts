/**
 * Vector Type — the solid-extrude BODY CACHE. **Zero paper.js.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE IS A STORE, NOT A COMPUTATION. Nothing here can unite anything.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A boolean union costs ~1.3 ms **per copy** — 575× the 2.25 µs it takes to
 * *draw* one — so a deep extrude united on a draw frame would drop 67
 * consecutive frames. The union was therefore walled off in `./extrudeSolid.ts`
 * behind three structural guarantees (an import graph that never reaches
 * `paper`, an `async` producer against a synchronous renderer, and a plain
 * `ReadonlyMap` where a callback would have been). **None of that is being
 * reopened.**
 *
 * What IS needed is for the live path to be able to *look at* a body somebody
 * else already computed — to stroke its silhouette, which cannot be derived from
 * N overlapping paths without fusing them first. So the memo that used to live
 * inside `extrudeSolid.ts` lives here instead, in a module that:
 *
 *   - imports **nothing** but two types (`VectorCommand`, `VtExtrudeCopy`), so
 *     `canvas.ts` can read it without pulling 300 kB of geometry library into
 *     the render path's import graph. That is not a style preference: it is what
 *     `vectortype-extrude-solid.unit.spec.ts`'s import-graph walk asserts, and
 *     that test caught a bare `import 'paper'` only after being deliberately
 *     broken to find the gap.
 *   - offers exactly one read (`peekSolidBody`) and exactly one write
 *     (`putSolidBody`), both **synchronous**, neither able to compute.
 *
 * The division of labour is therefore:
 *
 *   `extrudeSolid.ts`  WRITES  — it owns paper, and is only ever awaited off a
 *                                draw loop (a bake, an export, or the surface's
 *                                debounced watcher).
 *   anyone             READS   — `peekSolidBody` is a `Map.get`. On a miss the
 *                                caller falls back to the un-unioned copies,
 *                                which is a picture the user has already seen.
 *
 * That posture is `resolveField`'s, exactly: it returns `null` while a shader
 * field is still cooking and the caller draws the input rather than blocking. A
 * cold frame here is an unstroked extrude, and the stroke appears once the body
 * lands.
 *
 * ## The key is the union's whole input, verbatim
 *
 * The four things the union consumes are the glyph's placed commands, the copy
 * list, the glyph's origin and its advance. Nothing about time `t` enters the
 * computation except through those four, so a frame whose four are unchanged
 * has, **by construction**, the same body.
 *
 * A cheaper key — "(layer id, is anything animated?)", a length, a rounded hash
 * — needs a correct answer to "could this have moved?", and every wrong answer
 * hands frame 30 frame 0's body: a *plausible* solid extrude that is not the one
 * on screen. Keying on the numbers cannot be wrong. An axis track changes the
 * commands, a `distance` track changes the copies, a translate changes the
 * origin, tracking changes the advance; any of them misses and the union runs.
 *
 * It is also what makes the LIVE read safe. `canvas.ts` builds the key from the
 * geometry it is about to draw, so a hit is by definition the body of *this*
 * frame's copies. There is no staleness to reason about — a stale entry is not
 * expressible.
 */
import type { VectorCommand } from '~/lib/vector/svg'
import type { VtExtrudeCopy } from './extrude'

/** Entries kept. A 25-glyph line with 6 solid extrude layers is 150 bodies, so
 *  this holds a whole frame of the worst case with room for the frame before it
 *  (a bake stepping time re-asks for the same keys, in the same order). */
const SOLID_BODY_CACHE_MAX = 512

/** Insertion-ordered, so the oldest key is `keys().next()` — a Map is already an
 *  LRU-by-insertion and needs no second structure. */
const solidBodyCache = new Map<string, VectorCommand[]>()

/**
 * The cache key for one (glyph, copies, origin, advance) — the union's whole
 * input, verbatim.
 *
 * `formatNumber` is deliberately NOT used: a key that rounded could collide two
 * genuinely different frames of a slow animation, and this is the one place
 * where being conservative means being exact rather than being coarse.
 *
 * Both sides build the key with THIS function — the writer in `extrudeSolid.ts`
 * and the live reader in `canvas.ts` — because two spellings of "the same
 * inputs" is exactly how a reader would silently stop hitting a cache the writer
 * is filling, and the symptom (no stroke, ever) looks like a missing feature
 * rather than a bug.
 */
export function solidBodyCacheKey(
  commands: readonly VectorCommand[],
  copies: readonly VtExtrudeCopy[],
  origin: { x: number; y: number; rotate?: number },
  advance: number,
): string {
  const geom: string[] = []
  for (const c of commands) geom.push(c.command, ...(c.args ?? []).map(String))
  const step: string[] = []
  for (const c of copies) step.push(String(c.dx), String(c.dy), String(c.scale))
  // The placement's ROTATION is part of the input because the taper pivot is
  // derived from it (`extrudeCopyTransform`). In practice the placed `commands`
  // already carry the same turn, so it is belt-and-braces — but that is the right
  // posture for a key whose failure mode is handing one glyph another glyph's
  // body. Appended only when there IS a turn, so every straight run keys exactly
  // as it did before curves existed.
  const rot = Number.isFinite(origin.rotate as number) ? (origin.rotate as number) : 0
  const r = rot === 0 ? '' : `|r${rot}`
  return `${origin.x}|${origin.y}|${advance}${r}|${step.join(',')}|${geom.join(',')}`
}

/**
 * **Look, do not compute.** The body for `key`, or `undefined` if nobody has
 * united it yet.
 *
 * The name is the contract, and the contract is the whole reason this module
 * exists: `peek` never unites, never imports paper, never returns a promise and
 * never schedules work. It is a `Map.get`. A draw loop may call it on every
 * frame for every glyph and pay a hash lookup.
 *
 * `undefined` is a normal answer, not an error — it means "the union has not
 * landed for this exact geometry". The caller draws the un-unioned copies (and,
 * from Task 2, draws them unstroked), and the next frame after the surface's
 * debounced union completes will hit.
 *
 * The array is returned **by reference**: the writer and the readers only read
 * it. A caller that intends to mutate a body must copy it first, or it corrupts
 * every later frame.
 */
export function peekSolidBody(key: string): VectorCommand[] | undefined {
  return solidBodyCache.get(key)
}

/**
 * Store one computed body. Called only by `extrudeSolid.ts`, which is the only
 * module that can produce one.
 *
 * An EMPTY body is never stored: `unionCommandLists` returns `[]` both for
 * "nothing to unite" and for a caught paper failure, and neither is an answer
 * about the geometry. Caching one would make a single transient failure
 * permanent for the rest of a bake.
 */
export function putSolidBody(key: string, body: VectorCommand[]): void {
  if (!body.length) return
  if (solidBodyCache.size >= SOLID_BODY_CACHE_MAX) {
    const oldest = solidBodyCache.keys().next().value
    if (oldest !== undefined) solidBodyCache.delete(oldest)
  }
  solidBodyCache.set(key, body)
}

/** Drop every cached body. Nothing in the product needs this — the key is the
 *  whole input, so a stale entry is not expressible — but a test that measures
 *  the cold cost does. */
export function clearSolidExtrudeCache(): void {
  solidBodyCache.clear()
}

/** How many bodies are cached. For tests and for a memory probe; never a
 *  control. */
export function solidExtrudeCacheSize(): number {
  return solidBodyCache.size
}
