/**
 * Vector Type Studio — APPEARANCE-STACK motion presets, as motion TRACKS. PURE.
 *
 * ## Why this is a second table, and why that is not a mistake
 *
 * `./axisPresets.ts` is the first table and it says so in its own header: the
 * *frame* is frozen (`VtAxisPreset.axis`, one OpenType tag) and everything else
 * is derived from the loaded font. This module follows exactly that pattern —
 * declared frame, derived contents, disabled-with-a-reason — and deliberately
 * does NOT extend that table, because that table structurally cannot hold these.
 *
 * A gallery preset in this studio is **an id stored in a slot** (`motion.in`,
 * `motion.out`, `motion.loop`) that `presetMotion.ts` evaluates to a
 * `UnitState` / a set of axis deltas. Three walls, each independently fatal:
 *
 *  1. **A preset cannot write a config leaf.** `UnitState` is `dx / dy / scale /
 *     rotation / opacity / blur / clip / copies`, and `VtAxisPreset.fn` returns
 *     an axis coordinate. Neither has a channel to `appearance.<id>.angle`. The
 *     block shadow's direction is a leaf on a LAYER, not a per-unit transform.
 *  2. **A preset does not know the stack.** `vtAxisDelta(preset, e, i, n, axes,
 *     resting)` is handed glyph index, glyph count and the font's axes — never
 *     the config. It could not name a layer to aim at even if it had somewhere
 *     to write.
 *  3. **A slot holds exactly one id.** Misregistration drives TWO layers in
 *     opposition; there is nowhere in `LayerAnimSpec` to say which two.
 *
 * The mechanism that *can* express both is the one already shipped: a
 * `VtMotionTrack`, a dotted path into the config, evaluated by `applyMotion`.
 * That is the studio's own guarantee — `f(cfg, t) → paths`, so **every declared
 * slider is animatable for free** — and it was measured true here rather than
 * assumed (see `tests/unit/vectortype-track-presets.unit.spec.ts`).
 *
 * So what is missing is not capability, it is DISCOVERABILITY: a user has to
 * know that an extrude has an angle, that the angle is animatable, and that a
 * full turn of it is a light sweeping around the word. This table turns each of
 * those from a possibility into a tile.
 *
 * ## What is declared and what is derived
 *
 * DECLARED (frozen): the layer `kind` a preset cannot run without, how many it
 * needs, and the extra per-layer condition that makes a layer *usable* (a
 * `depth: 0` extrude paints nothing, so animating its angle animates nothing).
 *
 * DERIVED from the live config: which layers it will actually drive, whether the
 * tile is offered, the sentence shown when it cannot run, and the track values
 * themselves — a sweep starts from the angle the user already set, and a drift
 * reaches the plate offset they already chose.
 */
import {
  VT_STACK_PREFIX,
  type VectorTypeConfig,
  type VtAppearanceLayer,
  type VtLayerKind,
  type VtMotionTrack,
} from './config'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** One motion track, with this studio's own track defaults filled in. */
function track(path: string, from: number, to: number, over: Partial<VtMotionTrack> = {}): VtMotionTrack {
  return { path, from, to, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0, ...over }
}

/** What a preset is handed: the layers it matched, back to front, and the clip. */
export interface VtTrackPresetContext {
  layers: readonly VtAppearanceLayer[]
  /** Clip length in seconds. Present for a preset whose values depend on it;
   *  neither of the first two does, and that is a property worth keeping — a
   *  track's own `loops` already expresses "twice per clip". */
  duration: number
}

export interface VtTrackPreset {
  id: string
  label: string
  /** One line for the tile, in the picker's voice. */
  pitch: string
  /** THE DECLARATION — the layer kind this preset cannot run without. */
  kind: VtLayerKind
  /** How many such layers it needs. Two means two, and the reason says so. */
  minLayers: number
  /** The extra condition that makes a layer of that kind actually usable. A
   *  `depth: 0` extrude draws no copies, so a track on its angle is a row in the
   *  timeline that moves nothing — the dead-control failure this studio's
   *  schema exists to prevent, one level out. */
  usable: (l: VtAppearanceLayer) => boolean
  /** What an unusable layer is missing, spliced into the reason sentence. */
  requirement: string
  /** The tracks, derived from the layers it matched. */
  build: (ctx: VtTrackPresetContext) => VtMotionTrack[]
}

/**
 * The offset a misregistration drifts to when the plate is sitting at zero.
 *
 * In OUTPUT PIXELS, like `distance` itself. Small: a misprint is a few points
 * out of register, not a block shadow — at the measured 2× separation this is
 * 16 px of plate-to-plate drift, which reads as a bad print run rather than as
 * two words.
 */
export const VT_MISREGISTRATION_DRIFT = 8

const usableExtrude = (l: VtAppearanceLayer): boolean =>
  l?.kind === 'extrude' && isNum(l.depth) && l.depth >= 1

const PRESETS: VtTrackPreset[] = [
  {
    id: 'extrude-sweep',
    label: 'Light Sweep',
    pitch: 'The block shadow orbits the word — the light source moving',
    kind: 'extrude',
    minLayers: 1,
    usable: usableExtrude,
    requirement: 'a depth of at least 1',
    // ONE FULL TURN, starting where the user parked the slider. Starting at 0
    // instead would snap the design on the first frame; `angle + 360` is the
    // same direction as `angle`, so frame 0 and the last frame are identical and
    // an exported loop does not hard-cut.
    //
    // Every usable extrude sweeps, and they sweep TOGETHER: a two-plate stack
    // whose plates sit 180° apart keeps that separation all the way round, which
    // is what a single moving light does to two shadows.
    build: ({ layers }) => layers.map((l) => {
      const from = isNum(l.angle) ? l.angle : 0
      return track(`${VT_STACK_PREFIX}${l.id}.angle`, from, from + 360)
    }),
  },
  {
    id: 'misregistration',
    label: 'Misregistration',
    pitch: 'Ink plates drift out of register and back, like a bad print run',
    kind: 'extrude',
    minLayers: 1,
    usable: usableExtrude,
    requirement: 'a depth of at least 1',
    // PING-PONG from ZERO, so the word starts perfectly registered and drifts —
    // that is the whole read of the effect, and it also makes frame 0 the
    // in-register frame a still bake will capture.
    //
    // Each plate drifts along its OWN angle, so two plates set 180° apart move
    // in opposition and the separation is twice the distance (measured: 0 → 28 px
    // at distance 14). The preset does not impose the angles; the stack owns
    // them, and one plate alone slides out from under the face and back.
    //
    // The reach is the plate offset the user ALREADY set, when they set one — a
    // preset that overwrote it would throw away the design it was applied to.
    build: ({ layers }) => layers.map(l =>
      track(`${VT_STACK_PREFIX}${l.id}.distance`, 0,
        isNum(l.distance) && l.distance > 0 ? l.distance : VT_MISREGISTRATION_DRIFT,
        { easing: 'pingpong' })),
  },
]

/** Every track preset, in gallery order. */
export const VT_TRACK_PRESETS: readonly VtTrackPreset[] = Object.freeze(PRESETS)

/** The preset with that id, or null. */
export function vtTrackPreset(presetId: unknown): VtTrackPreset | null {
  if (typeof presetId !== 'string') return null
  return PRESETS.find(p => p.id === presetId.trim()) ?? null
}

// ── Availability, derived from the live stack ───────────────────────────────

export interface VtTrackPresetOffer {
  preset: VtTrackPreset
  /** The layers it would drive, back to front. Empty when unavailable. */
  layers: VtAppearanceLayer[]
  available: boolean
  /** Present IFF unavailable. Names what to add, because the user owns the
   *  stack and can act on it in the same panel — the same rule
   *  `vtAxisAvailability` follows for a missing axis. */
  reason?: string
}

/** A layer this preset could address: right kind, usable, and with an id that
 *  can be written as a stack path at all. An id that is all digits would be read
 *  as an array INDEX by `lib/studio/path.ts` (`mergeConfig` never mints one, so
 *  this is the raw-blob case) and a dot would split the path. */
const addressable = (p: VtTrackPreset, l: VtAppearanceLayer): boolean =>
  !!l && l.kind === p.kind && p.usable(l)
  && typeof l.id === 'string' && l.id !== '' && !l.id.includes('.') && !/^\d+$/.test(l.id)

/**
 * Can this preset run on this config's stack, and if not, WHY.
 *
 * Three ways to fail, and they are different sentences because they have
 * different fixes: no layer of the kind at all (add one), one that is there but
 * inert (raise its depth), and not enough of them (add another).
 *
 * DISABLED LAYERS COUNT AS ABSENT. A track pointing at a layer that is switched
 * off animates a layer that does not paint, which is the same dead row as a
 * `depth: 0` one.
 */
export function vtTrackPresetOffer(
  preset: VtTrackPreset,
  cfg: VectorTypeConfig | null | undefined,
): VtTrackPresetOffer {
  const stack = Array.isArray(cfg?.appearance) ? cfg.appearance : []
  const enabled = stack.filter(l => l && l.enabled !== false)
  const layers = enabled.filter(l => addressable(preset, l))
  if (layers.length >= preset.minLayers) return { preset, layers, available: true }

  const ofKind = enabled.filter(l => l?.kind === preset.kind)
  const noun = preset.kind === 'extrude' ? 'extrude layer' : `${preset.kind} layer`
  const reason = !ofKind.length
    ? `Add an ${noun} — this needs ${preset.minLayers === 1 ? 'one' : preset.minLayers} to drive.`
    : layers.length < ofKind.length
      ? `This ${noun} needs ${preset.requirement} before there is anything to animate.`
      : `Add ${preset.minLayers - layers.length} more ${noun}${preset.minLayers - layers.length === 1 ? '' : 's'}.`
  return { preset, layers: [], available: false, reason }
}

/** Every track preset, each marked available or not — the shape a gallery
 *  renders directly: available ones live, the rest greyed with their reason. */
export function vtTrackPresetOffers(cfg: VectorTypeConfig | null | undefined): VtTrackPresetOffer[] {
  return PRESETS.map(p => vtTrackPresetOffer(p, cfg))
}

// ── Application ─────────────────────────────────────────────────────────────

/**
 * The track list this config should have after applying `preset` — the CURRENT
 * tracks with the preset's own paths replaced, plus the preset's tracks.
 *
 * REPLACE, not append, and only on the paths the preset itself writes. Applying
 * a preset twice must not stack two tracks on one path (`applyMotion` is a plain
 * write per track, so the last one silently wins and the first is a dead row in
 * the timeline — measured: two opposed `glyph.dx` tracks compose to the second
 * one alone, not to their sum). Everything else the user authored is untouched,
 * because these presets compose with tracks and with the slot presets alike.
 *
 * Returns the SAME array when the preset cannot run, so a caller can skip the
 * write and the deep watcher it would trigger.
 */
export function vtApplyTrackPreset(
  cfg: VectorTypeConfig,
  presetId: unknown,
): VtMotionTrack[] {
  const existing = Array.isArray(cfg?.motion?.tracks) ? cfg.motion.tracks : []
  const preset = vtTrackPreset(presetId)
  if (!preset) return existing
  const offer = vtTrackPresetOffer(preset, cfg)
  if (!offer.available) return existing
  const added = preset.build({
    layers: offer.layers,
    duration: isNum(cfg?.motion?.duration) ? cfg.motion.duration : 4,
  })
  const claimed = new Set(added.map(t => t.path))
  return [...existing.filter(t => !claimed.has(typeof t?.path === 'string' ? t.path.trim() : '')), ...added]
}

/**
 * True when every track this preset would write is already present with the
 * values it would write — i.e. the tile should read as the ACTIVE one.
 *
 * Compared on the values rather than on a stored preset id, because these are
 * ordinary tracks the moment they land: the user may drag any of them, and a
 * tile that kept claiming to be active would be describing a design that is no
 * longer what it applied.
 */
export function vtTrackPresetActive(cfg: VectorTypeConfig, presetId: unknown): boolean {
  const preset = vtTrackPreset(presetId)
  if (!preset) return false
  const offer = vtTrackPresetOffer(preset, cfg)
  if (!offer.available) return false
  const wanted = preset.build({
    layers: offer.layers,
    duration: isNum(cfg?.motion?.duration) ? cfg.motion.duration : 4,
  })
  const have = Array.isArray(cfg?.motion?.tracks) ? cfg.motion.tracks : []
  return wanted.length > 0 && wanted.every(w => have.some(h =>
    h?.path === w.path && h.from === w.from && h.to === w.to && h.easing === w.easing))
}
