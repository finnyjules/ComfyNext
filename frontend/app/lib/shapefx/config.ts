import type { HarmonyType } from '../color/harmony'
import { normalizeShaderSpec, type FillType, type ShaderSpec } from '../spacetype/fillTile'
// Three-free (see settings.ts's own header) — safe for config.ts, which controls.ts's
// dynamic-import chain (Collection resolver) reaches, same posture as gradientfx/types.ts.
import { DEFAULT_POST, type PostSettings } from '~/lib/studio/post/settings'

export type ShapeMode = 'primitive' | 'gem'
export type PrimitiveKind =
  | 'cube' | 'sphere' | 'cone' | 'cylinder' | 'prism' | 'torus' | 'icosahedron' | 'octahedron'
export type FillMode = 'facets' | 'surface'
/** How the harmony ramp is painted onto the shape:
 *   prismatic — each facet gets its OWN gradient (anchored in the palette by position,
 *               spread across the facet along a per-facet direction) → cut-gem shimmer
 *   smooth    — per-vertex sample of the interpolated ramp (one gradient sweeps the surface)
 *   faceted   — one flat ramp-tone per facet, progressing smoothly facet-to-facet
 *   ombre     — the ramp rendered with a per-pixel grainy dither (solid → speckle → solid)
 *   scatter   — each facet a random discrete swatch + jitter (the low-poly confetti look) */
export type ColoringMode = 'prismatic' | 'smooth' | 'faceted' | 'ombre' | 'scatter'
/** Which spatial axis the smooth/faceted ramp follows. */
export type ColorDirection = 'vertical' | 'depth' | 'radial' | 'angular'
export type Projection = 'orthographic' | 'perspective'
export type SectionKey = 'shape' | 'palette' | 'style'

export interface ShapeParams {
  mode: ShapeMode
  primitive: PrimitiveKind
  /** Gem mode: number of scattered points (hull complexity). 4–40. */
  vertices: number
  /** Gem mode: elongation along Z, 0.2–2. */
  depth: number
  /** Gem mode: point-cloud spread, 0.1–1. */
  spread: number
  /** Primitive facet density → segment count / detail. 0–4 (integer steps). */
  density: number
  /** Seeded vertex-position jitter, 0–100 (0 = clean primitive; higher = crumpled/organic). */
  jitter: number
  /** Uniform scale of the shape in frame, 0.25–3 (1 = default framing). */
  scale: number
  projection: Projection
}

export interface PaletteParams {
  harmony: HarmonyType
  baseHue: number         // 0–360
  saturation: number      // 0–100
  lightness: number       // 0–100
  coloring: ColoringMode
  direction: ColorDirection // used by smooth & faceted (ignored by scatter)
}

export interface StyleParams {
  /** @deprecated 0–100 legacy grain slider, retired in Task 8 (grain moved into the
   *  shared post stack, retiring this studio's own uGrain uniform in ./post.ts).
   *
   *  THE REAL CONTRACT — read before touching this field or the code that reads it:
   *  this is a READ-ONLY MIGRATION INPUT that exists only on documents saved before
   *  Task 8. `mergeConfig` consumes it exactly once (deriving post.grain /
   *  post.grainAmount / post.grainSize and the `forceOffscreenPass` render-path pin
   *  from it) and then DROPS it — the merged config it returns never carries `grain`,
   *  so it is gone from the blob the next save writes. This mirrors
   *  gradientfx/types.ts's ReliefConfig.grain treatment exactly.
   *
   *  Nothing renders from it, nothing routes off it, and nothing may write it:
   *  writing a value here on a live config would re-fire the migration on the next
   *  load and clobber whatever the user had since set on the shared Grain controls.
   *  (That is precisely why randomize.ts's rollStyle no longer rolls it.) Deleting
   *  the field outright is safe only once no pre-Task-8 Shape document can still be
   *  loaded. */
  grain?: number
  distortion: number   // 0–100
  background: string   // '#rrggbb' or 'transparent'
}

export interface SurfaceFill {
  type: FillType
  a: string
  b: string
  angle: number
  density: number
  /** Only meaningful when `type === 'shader'`. Discovered gap (fixed alongside the shader-fill
   *  animation wiring): this field did not exist until now, and `toFill()` in `surface.ts` had
   *  nothing to read even when a caller forced `type: 'shader'` through the picker — so
   *  selecting "shader" in Shape Studio's Fill type dropdown silently degraded to the default
   *  shader input (a plain gradient), never actually reaching the shader renderer, and could
   *  not survive a save/reload either (`shader` wasn't in `FILLTYPES`'s mergeConfig whitelist).
   *  Still no dedicated effect/params PICKER UI for this field (unlike Space Type's fill-swatch
   *  editor) — that remains a separate, larger feature. This is the minimum plumbing needed for
   *  a `ShaderSpec` attached to a Shape Studio fill (via Import Settings JSON, var-bindings, or
   *  a future picker) to actually reach the renderer and persist. */
  shader?: ShaderSpec
}

export interface ShapeConfig {
  seed: string
  fillMode: FillMode
  shape: ShapeParams
  palette: PaletteParams
  fill: SurfaceFill
  style: StyleParams
  locks: Record<SectionKey, boolean>
  /** Shared post-processing stack — see ~/lib/studio/post. Runs AFTER
   *  style.distortion (this studio's own pass, ./post.ts's POST_FRAG); see
   *  engine.ts's drawFrame() for why both are active at once. */
  post: PostSettings
  /** Render-path compatibility pin, NOT a user control and NOT a look knob.
   *
   *  `postNeeded()` (./post.ts) routes a config through engine.ts's offscreen
   *  WebGLRenderTarget instead of straight to the canvas. That target has no MSAA
   *  where the canvas itself is created with `antialias: true`, so which path a
   *  document takes visibly changes its edges — an orthogonal, pre-existing quirk
   *  of Shape's pipeline that has nothing to do with any effect.
   *
   *  Before Task 8 the routing question was `style.grain > 0`, and style.grain
   *  defaulted to 20, so every document — saved or brand-new — took the offscreen
   *  path. Retiring the grain slider would have silently moved all of them onto the
   *  other path. This flag freezes that answer: mergeConfig's migration sets it ONCE
   *  from the legacy value (so a document that explicitly saved grain 0, and thus
   *  never took the pass, still doesn't), and DEFAULT_CONFIG ships it `true` so a new
   *  shape renders down the same path every shape always has. It then stays frozen no
   *  matter what the user later does to the shared Grain controls — which is the whole
   *  point: the amount is theirs, the render path is history.
   *
   *  Flipping the default to false would move every future document onto the
   *  antialiased path. That is arguably the nicer render, but it is a real appearance
   *  change (~40/255 mean on a representative fixture) and belongs to the separate
   *  fix that gives ensurePost()'s target proper MSAA, not to this migration. */
  forceOffscreenPass: boolean
}

export const DEFAULT_CONFIG: ShapeConfig = {
  seed: '#3a7f21c0',
  fillMode: 'facets',
  shape: { mode: 'primitive', primitive: 'cube', vertices: 14, depth: 1, spread: 0.65, density: 1, jitter: 0, scale: 1, projection: 'orthographic' },
  palette: { harmony: 'analogous', baseHue: 287, saturation: 57, lightness: 47, coloring: 'prismatic', direction: 'vertical' },
  fill: { type: 'gradient', a: '#ff4da6', b: '#6a3df0', angle: 45, density: 8 },
  // No `grain` here: the legacy 0-100 slider is a migration input only (see
  // StyleParams.grain), and DEFAULT_CONFIG describes a BRAND-NEW document, which by
  // definition has nothing to migrate. Consequence, deliberate and documented: a fresh
  // shape now ships with the shared stack's own neutral grain defaults (off) rather
  // than the old always-on touch of grain, which is what lets the control schema and
  // the config agree again (see shapefx-controls.unit.spec.ts's no-exceptions default
  // check). Its RENDER PATH is unchanged — see forceOffscreenPass below. Task 8's
  // charter is that documents saved BEFORE the change render identically after it;
  // those all carry style.grain and go through mergeConfig's migration.
  style: { distortion: 0, background: '#000000' },
  locks: { shape: false, palette: false, style: false },
  // Own object literal, not a reference to the shared DEFAULT_POST constant — this
  // constant is reused (spread, not aliased) by callers that build config literals
  // (randomize.ts, presets), same posture as every other DEFAULT_CONFIG field.
  post: { ...DEFAULT_POST },
  forceOffscreenPass: true,
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d)
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  (typeof v === 'string' && (allowed as readonly string[]).includes(v)) ? (v as T) : d
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)

const MODES = ['primitive', 'gem'] as const
/** The primitive solids, in UI order. Exported so the control schema offers exactly
 *  this set — a second hand-written copy would silently drop any new member. */
export const PRIMS = ['cube', 'sphere', 'cone', 'cylinder', 'prism', 'torus', 'icosahedron', 'octahedron'] as const
const FILLMODES = ['facets', 'surface'] as const
const COLORINGS = ['prismatic', 'smooth', 'faceted', 'ombre', 'scatter'] as const
const DIRECTIONS = ['vertical', 'depth', 'radial', 'angular'] as const
const PROJ = ['orthographic', 'perspective'] as const

// Legacy migration: the shipped v1 used a single `rule` ('facet'|'depth'|'height').
// Map old exported/persisted configs onto the new coloring+direction pair.
const LEGACY_COLORING: Record<string, ColoringMode> = { facet: 'scatter', depth: 'faceted', height: 'faceted' }
const LEGACY_DIRECTION: Record<string, ColorDirection> = { depth: 'depth', height: 'vertical' }
const HARMONIES = ['monochromatic', 'complementary', 'split-complementary', 'analogous', 'accented-analogous', 'triadic', 'tetradic', 'compound'] as const
const FILLTYPES = ['solid', 'gradient', 'ombre', 'grid', 'noise', 'checkerboard', 'stripes', 'qr', 'shader'] as const

/** Deep-merge an untrusted parsed value over DEFAULT_CONFIG so partial/old/junk configs stay safe. */
export function mergeConfig(raw: unknown): ShapeConfig {
  const o = (raw ?? {}) as Record<string, any>
  const d = DEFAULT_CONFIG
  const sh = (o.shape ?? {}) as Record<string, any>
  const pa = (o.palette ?? {}) as Record<string, any>
  const fi = (o.fill ?? {}) as Record<string, any>
  const st = (o.style ?? {}) as Record<string, any>
  const lo = (o.locks ?? {}) as Record<string, any>
  // The legacy grain slider's saved value, if this blob is old enough to carry one.
  // Read from the RAW blob (not through num()-with-default) precisely so "absent" and
  // "explicitly 0" stay distinguishable — that difference is what makes the migration
  // below one-time rather than a per-load re-derive. See StyleParams.grain.
  const legacyGrain = (typeof st.grain === 'number' && Number.isFinite(st.grain)) ? st.grain : undefined
  return {
    seed: str(o.seed, d.seed),
    fillMode: oneOf(o.fillMode, FILLMODES, d.fillMode),
    shape: {
      mode: oneOf(sh.mode, MODES, d.shape.mode),
      primitive: oneOf(sh.primitive, PRIMS, d.shape.primitive),
      vertices: num(sh.vertices, d.shape.vertices),
      depth: num(sh.depth, d.shape.depth),
      spread: num(sh.spread, d.shape.spread),
      density: num(sh.density, d.shape.density),
      jitter: num(sh.jitter, d.shape.jitter),
      scale: num(sh.scale, d.shape.scale),
      projection: oneOf(sh.projection, PROJ, d.shape.projection),
    },
    palette: {
      harmony: oneOf(pa.harmony, HARMONIES, d.palette.harmony),
      baseHue: num(pa.baseHue, d.palette.baseHue),
      saturation: num(pa.saturation, d.palette.saturation),
      lightness: num(pa.lightness, d.palette.lightness),
      coloring: oneOf(pa.coloring, COLORINGS, LEGACY_COLORING[pa.rule] ?? d.palette.coloring),
      direction: oneOf(pa.direction, DIRECTIONS, LEGACY_DIRECTION[pa.rule] ?? d.palette.direction),
    },
    fill: (() => {
      const fillType = oneOf(fi.type, FILLTYPES, d.fill.type)
      return {
        type: fillType,
        a: str(fi.a, d.fill.a),
        b: str(fi.b, d.fill.b),
        angle: num(fi.angle, d.fill.angle),
        density: num(fi.density, d.fill.density),
        // A spec on a non-shader fill is dropped, same rule normalizeFill's own shader
        // branch follows — reuses its sanitizer rather than a second hand-rolled one.
        shader: fillType === 'shader' ? normalizeShaderSpec(fi.shader, 0) : undefined,
      }
    })(),
    style: {
      // `grain` is deliberately NOT emitted — it is consumed once, below, and
      // dropped (see StyleParams.grain). Mirrors gradientfx/types.ts, which
      // `delete`s relief.grain for the same reason.
      distortion: num(st.distortion, d.style.distortion),
      background: str(st.background, d.style.background),
    },
    locks: {
      shape: bool(lo.shape, d.locks.shape),
      palette: bool(lo.palette, d.locks.palette),
      style: bool(lo.style, d.locks.style),
    },
    // Backfill post the same way GradientConfig's ensureConfigDefaults does (see
    // gradientfx/types.ts) — a config saved before this field existed (or a bare
    // {}) gets every post.* key at its DEFAULT_POST (off) value; a partial object
    // (e.g. an agent patch that set only post.bloom) keeps its own keys and only
    // backfills what's missing. No per-key validation, matching Gradient's own
    // backfill — PostSettings' own consumers (postControls' sliders) already clamp.
    //
    // ONE-TIME grain migration (Task 8). Fires only for a blob that actually carries
    // the legacy `style.grain` field (`legacyGrain` above), and `style` above drops
    // that field from the result — so it fires at most once per document, and from
    // then on the saved `post` is the single source of truth. This is what makes a
    // user's own Grain edit survive a save/reload: an unconditional re-derive here
    // would silently restore the migrated value on every single load, and since the
    // legacy slider is gone from controls.ts there would be no control able to undo
    // it. (Covered by post-grain-migration.unit.spec.ts's round-trip test.)
    //
    // Rescale: Shape's retired formula (`g * uGrain * 0.5 * midtone`, see the old
    // ./post.ts) used a 0.5 coefficient on a 0-100 slider where Gradient's canonical
    // shared formula (post_grain.frag) uses 0.16 on a 0-1 amount — so the same slider
    // value rendered ~3.1x stronger, despite ./post.ts's now-deleted comment claiming
    // the two matched. (grain/100) * (0.5/0.16) lands it in the canonical space.
    //
    // CEILING (brief-mandated, and a known small fidelity loss): post.grainAmount is
    // the shared slider's own 0..1 range, but the rescale reaches 1.0 at
    // style.grain == 32 — so any document saved with grain above 32 (the old slider
    // went to 100, and rollStyle used to roll up to 45) is clamped and renders
    // WEAKER than it did before. Everything at or below 32 is exact.
    //
    // grainSize is force-pinned to 1: post_grain.frag's cell-quantisation (keyed to
    // grainSize) has no equivalent in Shape's old formula (verified: no
    // u_size/coarseness term in ./post.ts's old grain block) — the port is bit-exact
    // only at grainSize <= 1, same trap as Gradient's.
    post: (() => {
      const post = { ...DEFAULT_POST, ...(o.post ?? {}) }
      if (legacyGrain !== undefined && legacyGrain > 0) {
        post.grain = true
        post.grainAmount = Math.min(1, (legacyGrain / 100) * (0.5 / 0.16))
        post.grainSize = 1
      }
      return post
    })(),
    // Render-path pin — see ShapeConfig.forceOffscreenPass and postNeeded(). Frozen
    // from the legacy value at migration time (that value IS the pre-Task-8 routing
    // answer), and simply carried through on every load after that.
    forceOffscreenPass: legacyGrain !== undefined
      ? legacyGrain > 0
      : bool(o.forceOffscreenPass, d.forceOffscreenPass),
  }
}
