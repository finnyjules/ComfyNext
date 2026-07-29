/**
 * Vector Type — EXTRUDE, as repeated offset copies of the glyph path.
 *
 * ## What this is, and what it deliberately is not
 *
 * An extrude layer draws the SAME glyph path N more times, each translated (and
 * optionally scaled) behind the face. That is the classic block-shadow /
 * retro-lettering look, and it is the whole trick: no new geometry is invented,
 * so the studio's output stays **real editable vector** and Task 6 can emit the
 * copies as ordinary `<path>` elements.
 *
 * Three things it is NOT, each ruled out on purpose:
 *
 *  - **not a true outline offset.** A geometric offset (dilating the outline
 *    normal-wards) needs a library paper 0.12 does not have, and it is its own
 *    project. The plan says so out loud.
 *  - **not 3D.** Scene3D's `ExtrudeGeometry` is real depth and feeds a RASTER
 *    pipeline; routing type through it would leave the vector path entirely.
 *  - **not the boolean union, here.** `solid: true` fuses the copies into one
 *    body, and that lives in `./extrudeSolid.ts` because paper.js `unite` is far
 *    too slow for a draw loop (plan trap 5). Live preview draws the un-unioned
 *    stack, which is what this module describes. The two are kept in separate
 *    files on purpose: `canvas.ts` imports THIS one and never that one, so the
 *    draw loop structurally cannot reach the union.
 *
 * ## Why this file is pure
 *
 * `extrudeOffsets` is plain arithmetic over four numbers: no canvas, no DOM, no
 * `Path2D`, no matrices. The renderer decides WHERE a copy is drawn from and what
 * it is painted with; this decides only how far each copy steps and how much it
 * shrinks. That split is what makes the geometry testable as data — the highest
 * test leverage this studio has found — and it is also what lets the SVG writer
 * (Task 6) reuse the identical numbers instead of re-deriving them, which is the
 * "Smart Layout render parity" failure this codebase keeps paying for.
 */
import type { Transform2D, VectorCommand } from '~/lib/vector/svg'
import { transformCommands } from '~/lib/vector/svg'
import { VT_EXTRUDE_DEPTH_MAX, type VtAppearanceLayer } from './config'

/**
 * One offset copy of the glyph path.
 *
 * `dx`/`dy` are in the SAME units the glyph path is drawn in — output pixels
 * before the device `pixelRatio`, exactly like `width` (stroke) — so an extrude
 * does not shrink when `size` drops, and a 2× bake steps by the same visual
 * distance as the 1× preview.
 *
 * `scale` is a multiplier on the copy, 1 = the same size as the face.
 */
export interface VtExtrudeCopy {
  dx: number
  dy: number
  /** 1 = the face's size. `> 1` is possible: a NEGATIVE taper grows the copies. */
  scale: number
}

/**
 * The floor a tapered copy's scale is held at.
 *
 * `taper: 1` means "the farthest copy has vanished", and a scale of exactly 0
 * makes the CTM singular — Chrome then drops the drawing op entirely, and a
 * negative scale would MIRROR the copy, which is a wrong picture rather than a
 * missing one. This is the same guard `canvas.ts`'s `nonZero` applies to the
 * motion scale, at the same magnitude of caution.
 */
export const VT_EXTRUDE_MIN_SCALE = 0.02

const fin = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** The four numbers an extrude is derived from. A `VtAppearanceLayer` satisfies
 *  it; so does an object literal, which is how the spec drives this. */
export type VtExtrudeSpec = Pick<VtAppearanceLayer, 'depth' | 'angle' | 'distance' | 'taper'>

/**
 * The offset copies an extrude layer draws, **BACK TO FRONT**.
 *
 * `[0]` is the FARTHEST copy and the last element is the one nearest the face,
 * so a caller draws them in array order and the nearer copies land on top —
 * the same "array order is paint order" convention the appearance stack itself
 * uses, one level down. Getting this backwards is invisible in a solid-colour
 * extrude and glaring in a tapered or translucent one.
 *
 * ## The four knobs
 *
 * | knob | meaning |
 * |---|---|
 * | `depth` | how many copies. `0` → **no copies at all**, i.e. an inert layer. |
 * | `angle` | direction in degrees, `dx = cos θ`, `dy = sin θ`. |
 * | `distance` | pixels between CONSECUTIVE copies, so copy *k* sits at `k × distance`. |
 * | `taper` | scale falloff across the extrude: the farthest copy is `1 - taper`. |
 *
 * **The angle convention is canvas's own, and the house's.** `dx = cos θ`,
 * `dy = sin θ` with y pointing DOWN — identical to `fillTile`'s gradient/stripe
 * angle, which is the only other direction-in-degrees this codebase exposes to a
 * user. So `0°` steps right, `90°` steps DOWN, and the stored default `135°`
 * steps down-left. Picking a private convention here (a compass bearing, say)
 * would mean two "angle" sliders in the same panel — `layer.paint.angle` and
 * `layer.angle` — that rotate in different directions.
 *
 * **The taper ramp is linear in the copy index**, `scale_k = 1 - taper·(k/n)`,
 * so `taper: 1` puts the farthest copy at the `VT_EXTRUDE_MIN_SCALE` floor and
 * `taper: -1` doubles it. Linear rather than geometric because the control is a
 * symmetric −1..1 slider and a user dragging it expects the far end to move at a
 * steady rate; a geometric falloff collapses almost entirely in the first third
 * of the slider.
 *
 * ## What it refuses to do
 *
 * `depth` is bounded by `VT_EXTRUDE_DEPTH_MAX` — the SAME bound `mergeLayer`
 * clamps a stored `depth` to, so this is not a second, quieter cap: it is the
 * one cap, applied again for a layer that reached the renderer without being
 * merged (`vtDrawLayers` hands over a raw pre-stack blob's array as-is). A
 * non-finite `depth`/`angle`/`distance`/`taper` falls back rather than
 * propagating `NaN` into a matrix, where it would blank the whole glyph.
 *
 * @param cap An extra, LOWER bound on the copy count. The renderer passes one
 *   when a frame's total copy budget is spent, and **it logs when it does** —
 *   see `VT_EXTRUDE_FRAME_BUDGET`. Defaults to no extra bound. The taper ramp is
 *   spread over the copies that actually draw, so a capped extrude is a SHORTER
 *   extrude rather than an abruptly truncated one.
 */
export function extrudeOffsets(
  layer: VtExtrudeSpec | null | undefined,
  cap: number = VT_EXTRUDE_DEPTH_MAX,
): VtExtrudeCopy[] {
  const asked = Math.round(fin(layer?.depth, 0))
  const n = Math.min(
    clamp(asked, 0, VT_EXTRUDE_DEPTH_MAX),
    Math.max(0, Math.floor(fin(cap, VT_EXTRUDE_DEPTH_MAX))),
  )
  if (n <= 0) return []

  const rad = (fin(layer?.angle, 0) * Math.PI) / 180
  const ux = Math.cos(rad)
  const uy = Math.sin(rad)
  const distance = fin(layer?.distance, 0)
  const taper = clamp(fin(layer?.taper, 0), -1, 1)

  const out: VtExtrudeCopy[] = []
  // k counts DOWN from the farthest copy, so the array is back to front.
  for (let k = n; k >= 1; k--) {
    const step = distance * k
    out.push({
      dx: ux * step,
      dy: uy * step,
      scale: Math.max(VT_EXTRUDE_MIN_SCALE, 1 - taper * (k / n)),
    })
  }
  return out
}

/**
 * ONE copy's placement, as a `Transform2D` in the glyph's own OUTPUT space.
 *
 * The single derivation of "where a copy goes", shared by the three surfaces
 * that need it — the flat canvas path (`ctx.translate`/`ctx.scale`), the
 * anchored canvas path (a `DOMMatrix` composed onto the paint transform) and the
 * SOLID union (`transformCommands` on the placed command list). Three
 * re-derivations of a translate-and-scale is exactly the "Smart Layout render
 * parity" failure this studio keeps paying for, and here it would be worse than
 * usual: a union that disagreed with the preview by a pixel produces a *plausible*
 * solid extrude that is not the one on screen.
 *
 * ## The pivot
 *
 * A tapered copy scales about the glyph CELL's centre along the baseline and
 * about the BASELINE across it — the same pivot the motion `scaleX`/`scaleY`
 * block uses, and for the reason written down there: type scales about its
 * baseline, and pinning the left edge would make each copy drift rightwards as
 * it shrank, so a tapered extrude would BEND rather than recede.
 *
 * **In the GLYPH's frame, not the output's** — see `vtCellPivot`. On a straight
 * run those are the same frame and the arithmetic is unchanged; on a curve the
 * cell centre is half an advance along the glyph's own TANGENT, and taking it
 * along the output's x instead puts the pivot somewhere off the letter, so the
 * copies of a tapered extrude slew sideways instead of converging on it.
 *
 * ## Why the pivot is folded into `x`/`y` rather than left as three steps
 *
 * `translate(dx,dy) · translate(p) · scale(s) · translate(-p)` collapses to
 * `p' = p·s + (d + pivot·(1-s))`, which is exactly what a `Transform2D` says.
 * At `scale === 1` the pivot term is exactly `0` — not approximately — so the
 * overwhelmingly common untapered copy is a bare translate with no float noise
 * introduced by the fold.
 *
 * `flipY` is always `false`: the y flip is baked into the placed coordinates long
 * before a copy is taken (see `render.ts`'s header), so a copy that flipped again
 * would draw the extrude upside-down behind an upright face.
 */
export function extrudeCopyTransform(
  c: VtExtrudeCopy,
  /** The glyph's PLACED origin — its left edge on the baseline, in output px.
   *  `rotate` (degrees) comes straight off a `glyphTransform` result, so no
   *  caller has to remember to pass the angle and no two callers can pass a
   *  different one. */
  origin: { x: number; y: number; rotate?: number },
  /** The glyph's advance in OUTPUT pixels — the other half of the pivot. */
  advance: number,
): Required<Transform2D> {
  const s = Number.isFinite(c?.scale) ? c.scale : 1
  const p = vtCellPivot(advance, origin.rotate)
  const px = origin.x + p.x
  const py = origin.y + p.y
  return {
    scale: s,
    // A copy is a translate-and-scale in the OUTPUT space the placed commands
    // are already in, so it never rotates — including on a curve, where the
    // glyph's own turn is already baked into those commands. ONE absolute light
    // direction: every letter's block shadow steps the same way whatever angle
    // the letter sits at, which is what a single light source looks like and
    // what the `angle` control promises. Stepping in each glyph's own frame
    // instead makes the shadows fan outwards around the arc like a starburst.
    //
    // The taper PIVOT is the one part that IS in the glyph's frame, because it
    // is a point on the letter rather than a direction in the scene.
    rotate: 0,
    x: (Number.isFinite(c?.dx) ? c.dx : 0) + px * (1 - s),
    y: (Number.isFinite(c?.dy) ? c.dy : 0) + py * (1 - s),
    flipY: false,
  }
}

/**
 * The glyph CELL's centre, as an offset from the glyph's PLACED ORIGIN — the
 * ONE derivation of the pivot a per-glyph scale turns about.
 *
 * Half an advance along the glyph's own baseline, and nothing across it: type
 * scales about its baseline. On a straight run that is `(advance/2, 0)` and the
 * arithmetic below is the identical expression it always was — `rotate === 0`
 * takes a branch rather than folding `cos 0`/`sin 0`, so every flat run lands on
 * the same doubles. On a curve the baseline is the TANGENT, so the offset turns
 * with it.
 *
 * Shared, and it has to be: FOUR surfaces scale a glyph about this point and a
 * disagreement between any two is a plausible picture that is not the one on
 * screen —
 *
 *  1. `extrudeCopyTransform` above (which is itself the one derivation the
 *     canvas fast path, the canvas anchored path, the SVG `expand` and the
 *     boolean union all step their copies with);
 *  2. the canvas's motion `scaleX`/`scaleY` block;
 *  3. `glyphSvgTransform`, the same motion written as an SVG transform list;
 *  4. `glyphSvgMatrix`, the same list again as numbers, which a test already
 *     holds against (3).
 *
 * It lives HERE rather than in `./render` so `./extrude` stays a leaf — this
 * file imports nothing but the spine's types and the config's bound.
 */
export function vtCellPivot(
  /** The glyph's advance in OUTPUT pixels. */
  advance: number,
  /** The placement's rotation in DEGREES — `0`/absent for every straight run. */
  rotate: number | undefined,
): { x: number; y: number } {
  const hx = Number.isFinite(advance) ? advance / 2 : 0
  const rot = Number.isFinite(rotate as number) ? (rotate as number) : 0
  if (rot === 0) return { x: hx, y: 0 }
  const rad = (rot * Math.PI) / 180
  return { x: hx * Math.cos(rad), y: hx * Math.sin(rad) }
}

/**
 * A per-glyph motion OFFSET (`VtGlyphTransform.dx`/`dy`) taken into the GLYPH's
 * own frame — the ONE derivation of where a translated glyph goes.
 *
 * ## The decision this encodes, and why it went this way
 *
 * Task 4 measured the alternative and left it: `dx`/`dy` were applied in OUTPUT
 * space, so on a bent run a glyph translated "up" moved up the SCREEN rather
 * than up off its OWN baseline. Through the `mask-up` preset that cost 16.6
 * points of spread at t=0.15 — at arc 330 the letter crossed its (correctly
 * turned) mask window instead of travelling along the axis the window masks.
 *
 * Both readings are defensible in the abstract. Four things decide it:
 *
 *  1. **`dy` is baseline shift, and every type tool on earth makes baseline
 *     shift radial on a path.** Illustrator, InDesign and After Effects all move
 *     type-on-a-path off the CURVE, not down the artboard. This is the one
 *     channel with an established meaning, and it is not the output one.
 *  2. **It is the only channel that was not already local.** A glyph's `rotate`
 *     composes onto its placement angle, its `scaleX`/`scaleY` pivot is the cell
 *     centre IN THE GLYPH'S FRAME (`vtCellPivot`, above), and its mask window is
 *     the glyph's own cell. One channel in a different frame is not a design, it
 *     is an omission — and it is the one that breaks the mask contract.
 *  3. **The "one absolute direction" rule is about the SCENE, not the letter.**
 *     `extrudeCopyTransform` keeps `rotate: 0` because a block shadow implies a
 *     light source, and one scene has one light; `vtGlyphPaintBox` stays
 *     axis-aligned because a ramp is a direction across the picture. A motion
 *     offset is neither — it is the letter's own movement, like its own spin.
 *  4. **The disagreement grows with exactly the thing that makes local right.**
 *     On a gentle 30° headline arch the two frames differ by a few degrees and
 *     nobody can tell; they diverge only towards a ring, which is precisely the
 *     badge case where radial is unarguable.
 *
 * `rotate === 0` takes a BRANCH rather than folding `cos 0`/`sin 0`, so every
 * straight run — which is every run that exists today, since the placement only
 * ever turns on a curve — lands on the identical doubles it always did. This
 * change cannot move a flat composition by a float.
 *
 * Three surfaces translate a glyph and all three call this: the canvas motion
 * block, `glyphSvgTransform` and `glyphSvgMatrix`. Same discipline, and the same
 * reason, as `vtCellPivot` above.
 */
export function vtGlyphOffset(
  /** Output-pixel offset along the glyph's own baseline (+x = forward). */
  dx: number,
  /** Output-pixel offset across it (+y = below the baseline, y-down). */
  dy: number,
  /** The placement's rotation in DEGREES — `0`/absent for every straight run. */
  rotate: number | undefined,
): { x: number; y: number } {
  const ox = Number.isFinite(dx) ? dx : 0
  const oy = Number.isFinite(dy) ? dy : 0
  const rot = Number.isFinite(rotate as number) ? (rotate as number) : 0
  if (rot === 0) return { x: ox, y: oy }
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: ox * cos - oy * sin, y: ox * sin + oy * cos }
}

/**
 * One glyph's placed command list → **one command list per copy**, back to
 * front.
 *
 * The geometry half of an extrude, and now the ONLY derivation of it: the SVG
 * export flatMaps a glyph to exactly this (`GlyphPaint.expand`) and the boolean
 * union unites exactly this (`solidExtrudeBody`). Before, those two built the
 * same list from `extrudeCopyTransform` separately — which is the shape of the
 * drift this studio keeps paying for, one level below where `extrudeCopyTransform`
 * itself already fixed it.
 *
 * The canvas does NOT call it, and cannot: it never materialises a copy's
 * command list at all, because replaying a `Path2D` under a `ctx.translate` is
 * far cheaper than transforming a few hundred numbers per copy per frame. What
 * it shares is the transform, which is the part that could disagree.
 *
 * `commands` are the glyph's PLACED coordinates (`placeOutlines`), so the output
 * is in the same output space and drops straight into a `VectorShape`.
 */
export function extrudeCopyCommands(
  commands: readonly VectorCommand[],
  copies: readonly VtExtrudeCopy[],
  origin: { x: number; y: number; rotate?: number },
  advance: number,
): VectorCommand[][] {
  return copies.map(c => transformCommands(commands, extrudeCopyTransform(c, origin, advance)))
}

/**
 * The unioned bodies a SOLID extrude draws, keyed by `vtSolidKey`.
 *
 * ═══ THE BAKE/EXPORT BOUNDARY, AS A DATA TYPE (plan trap 5) ═══
 *
 * This is deliberately **plain, already-computed geometry** rather than a
 * function the renderer could call. `drawVectorType` is SYNCHRONOUS and the union
 * is `async` (paper.js is lazily imported), so the draw loop cannot produce this
 * even if someone tried; it can only be handed one that a bake or an export
 * already awaited. A frame with no map draws the un-unioned stack, which is what
 * every live path does and must keep doing.
 *
 * It lives in THIS module — the pure one — precisely so `canvas.ts` can name the
 * type without importing `./extrudeSolid.ts`, i.e. without paper.js being
 * reachable from the render path at all.
 *
 * Commands are in the SAME placed output space as the glyph's own path (what
 * `placeOutlines` returns), so a body is drawn exactly where the un-unioned
 * copies would have been drawn, under the same motion transform and the same
 * paint space.
 *
 * **This is also the interface Task 6 (SVG) consumes**: one body per (layer,
 * glyph) is one `<path>`'s worth of commands, so a solid extrude layer
 * `flatMap`s to ONE shape per glyph where an un-solid one flatMaps to `depth`.
 */
export type VtSolidBodies = ReadonlyMap<string, readonly VectorCommand[]>

/**
 * The key one unioned body is stored under: the LAYER'S STABLE ID and the glyph
 * index.
 *
 * The id, never the layer's position — trap 2. A map keyed by stack index would
 * silently hand layer 3's body to whatever moved into slot 3 after a reorder,
 * and the picture would still be a solid extrude, just the wrong one.
 */
export function vtSolidKey(layerId: string, glyphIndex: number): string {
  return `${layerId}#${glyphIndex}`
}

/**
 * How many offset copies one FRAME may draw, summed over every extrude layer and
 * every glyph.
 *
 * The cost of an extrude is `depth × glyphs` filled paths, per extrude layer, per
 * frame — and none of the three factors is small: `VT_EXTRUDE_DEPTH_MAX` is 32,
 * `VT_LAYER_MAX` is 6, and the text is whatever the user typed. Six extrude
 * layers at full depth over a 24-letter line is 4,608 path fills in one frame,
 * which is not a 60fps budget on any machine.
 *
 * So the frame gets a budget and `drawVectorType` spends it back-to-front,
 * shortening the LAST extrude layers first (the ones nearest the face contribute
 * least to the silhouette). Two properties this deliberately keeps:
 *
 *  - **nothing is silently truncated.** The frame reports `extrudeDropped` — the
 *    number of copies the budget removed — exactly as `frozenFields` reports a
 *    frozen shader field, and for the same reason: a user whose extrude quietly
 *    got shallower reads it as "the depth slider stopped working", and there is
 *    nothing in the picture that says otherwise.
 *  - **the common case never pays.** The default `depth: 8` over a normal word
 *    is a couple of hundred copies, two orders of magnitude inside the budget, so
 *    the budget is a ceiling on pathological configs rather than a quality knob.
 *
 * ## The number, and where it came from
 *
 * MEASURED, not guessed. On a 2400×800 device canvas (a 1200×400 preview at
 * `pixelRatio: 2`) one offset copy costs **2.25 µs**: a 25-glyph line at
 * `depth: 32` — 800 copies — draws in **2.8 ms median / 5.3 ms p95**, against a
 * 1.0 ms baseline for the same line with no extrude at all.
 *
 * At 2.25 µs a copy, this ceiling is ~5.4 ms of fill — a third of a 60fps frame
 * here, and still a frame on a machine three times slower. It is set so that a
 * SINGLE extrude at full depth is never bounded in practice (2400 ÷ 32 = 75
 * glyphs, beyond any one line of display type) while the pathological case the
 * bound exists for — six extrude layers over a long line, 4,800 copies and about
 * 11 ms here — is caught.
 */
export const VT_EXTRUDE_FRAME_BUDGET = 2400

/**
 * Per-layer copy caps that fit `VT_EXTRUDE_FRAME_BUDGET`, given each layer's
 * requested depth and the glyph count.
 *
 * Pure, and separate from `extrudeOffsets` so the budget arithmetic is testable
 * without a canvas too. Returns one cap per input depth, in the same order, plus
 * the number of copies the budget removed (`dropped`, `0` when nothing was
 * bounded — the overwhelmingly common answer).
 *
 * Layers are shortened from the FRONT of the stack backwards: the copies nearest
 * the face are the ones the layers above are most likely to cover anyway.
 */
export function extrudeBudget(
  depths: number[],
  glyphs: number,
  budget: number = VT_EXTRUDE_FRAME_BUDGET,
): { caps: number[]; dropped: number } {
  const caps = depths.map(d => clamp(Math.round(fin(d, 0)), 0, VT_EXTRUDE_DEPTH_MAX))
  const n = Math.max(0, Math.floor(fin(glyphs, 0)))
  if (n <= 0) return { caps, dropped: 0 }
  const limit = Math.max(0, Math.floor(fin(budget, VT_EXTRUDE_FRAME_BUDGET)))

  let total = caps.reduce((s, d) => s + d * n, 0)
  if (total <= limit) return { caps, dropped: 0 }

  let dropped = 0
  for (let i = caps.length - 1; i >= 0 && total > limit; i--) {
    const d = caps[i] as number
    if (d <= 0) continue
    // How many copies THIS layer must give up, at n glyphs each.
    const shed = Math.min(d, Math.ceil((total - limit) / n))
    caps[i] = d - shed
    dropped += shed * n
    total -= shed * n
  }
  return { caps, dropped }
}
