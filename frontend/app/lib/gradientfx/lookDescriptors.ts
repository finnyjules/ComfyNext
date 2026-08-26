import { buildGradientPreset } from './presets'

/**
 * What each gradient preset actually RENDERS as.
 *
 * The point of this file is the one Julien put his finger on: the model does not
 * know how to translate an idea into our gradient machinery, so we stop asking
 * it to. It gets a menu of looks described in plain terms — colours, direction,
 * tone, busyness, a mood phrase — and picks from it. Our code does the
 * translating.
 *
 * EVERY FIELD BELOW WAS MEASURED, NOT REMEMBERED. Each preset was rendered
 * through the real studio (gradient lab, 2026-08-26) and read with the same
 * checkers `lib/agent/takes.ts` uses on take thumbnails: a hue histogram for
 * `colors`, row-vs-column change for `direction`, mean luminance for `tone`, and
 * the mean of the two axis energies for `busy`. The numbers are recorded beside
 * each entry so the drift guard can re-measure and the next reader can check my
 * arithmetic rather than trust my adjectives.
 *
 * `mood` is the one human sentence per preset. It is written to be checkable
 * against the same numbers — "dark" appears only where tone measured dark,
 * "busy" only where the energy is high — so it cannot drift into flattery.
 */

/** The colour words the checker can name, so a descriptor can never claim one it
 *  cannot measure. Mirrors `MEASURABLE_COLORS` in `lib/agent/takes.ts`. */
export type LookColor =
  | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'cyan' | 'blue' | 'purple'
  | 'magenta' | 'pink' | 'white' | 'grey' | 'black'

export type LookDirection = 'vertical' | 'horizontal' | 'radial' | 'none'
export type LookTone = 'dark' | 'mid' | 'light'

export interface LookDescriptor {
  /** The two or three colours that dominate its render, most first. */
  colors: LookColor[]
  direction: LookDirection
  tone: LookTone
  /** Mean per-channel change between neighbouring pixels, 0..255 — how much is
   *  going on. Under ~5 is a smooth wash; over ~25 is a busy, textured field. */
  busy: number
  /** One sentence a person could match to a picture. */
  mood: string
}

/**
 * Measured 2026-08-26 in `/dev/gradient-studio-lab` at 160px tiles, one preset
 * per take, read off the real rendered thumbnails.
 *
 * The recorded `busy` is that run's measurement; `DRIFT_TOLERANCE` below is how
 * far a re-measure may wander before the guard calls it drift.
 */
export const LOOK_DESCRIPTORS: Record<string, LookDescriptor> = {
  // blue 56% / white 40% — radial, light, 6.3
  marble: { colors: ['blue', 'white'], direction: 'radial', tone: 'light', busy: 6.3,
    mood: 'cool veined stone, pale and calm' },
  // pink 29% / green 25% / magenta 12% — radial, mid, 18.1
  oil: { colors: ['pink', 'green', 'magenta'], direction: 'radial', tone: 'mid', busy: 18.1,
    mood: 'iridescent petrol swirl, many colours at once' },
  // white 55% / grey 24% / black 12% — none, light, 32.3
  ink: { colors: ['white', 'grey', 'black'], direction: 'none', tone: 'light', busy: 32.3,
    mood: 'monochrome ink in water, high contrast and busy' },
  // red 61% / orange 25% / yellow 12% — radial, mid, 24.9. Re-measured
  // 2026-08-26 (authored seed #xixo4m99) after the liquid Depth & Light soft
  // limits (shaders.ts): lava runs Depth 100, so the fix removed the
  // clamp-flattened blotches that read as undirected noise — the glow now reads
  // from its bright centre (none → radial) and busy roughly halved (the re-run
  // read 47.5 pre-fix vs 24.9 post-fix; the 36.2 recorded before this session
  // came from the original measuring session, whose exact seed/settings did not
  // reproduce, so only the pre/post DELTA here is like-for-like).
  lava: { colors: ['red', 'orange', 'yellow'], direction: 'radial', tone: 'mid', busy: 24.9,
    mood: 'molten heat, glowing and turbulent' },
  // blue 52% / purple 19% / magenta 13% — radial, light, 8.0
  satin: { colors: ['blue', 'purple', 'magenta'], direction: 'radial', tone: 'light', busy: 8.0,
    mood: 'soft silky sheen, pastel and gentle' },
  // magenta 60% / orange 19% / red 12% — horizontal, mid, 7.4. Re-measured
  // 2026-08-26 (seed #default0) after the liquid Depth & Light soft limits
  // (shaders.ts): centring the tilt term removed the old shading's spurious
  // flat-surface brightening, so mean luminance dropped from the light band
  // into mid (0.641 → 0.562 in the same-seed pre/post comparison).
  liquid: { colors: ['magenta', 'orange', 'red'], direction: 'horizontal', tone: 'mid', busy: 7.4,
    mood: 'warm liquid flow running sideways' },
  // black 30% / blue 17% / orange 12% — radial, dark, 19.5
  ripple: { colors: ['black', 'blue', 'orange'], direction: 'radial', tone: 'dark', busy: 19.5,
    mood: 'dark concentric rings spreading from the centre' },
  // black 36% / orange 15% / blue 14% — radial, mid, 14.8
  stack: { colors: ['black', 'orange', 'blue'], direction: 'radial', tone: 'mid', busy: 14.8,
    mood: 'banded rings, graphic and layered' },
  // magenta 54% / purple 32% / pink 14% — radial, mid, 1.4
  mesh: { colors: ['magenta', 'purple', 'pink'], direction: 'radial', tone: 'mid', busy: 1.4,
    mood: 'soft blurred colour wash, almost no detail' },
  // magenta 56% / orange 31% — horizontal, mid, 24.9
  linear: { colors: ['magenta', 'orange'], direction: 'horizontal', tone: 'mid', busy: 24.9,
    mood: 'a plain two-tone ramp, side to side' },
  // pink 31% / orange 19% / blue 16% — vertical, light, 1.7
  dawn: { colors: ['pink', 'orange', 'blue'], direction: 'vertical', tone: 'light', busy: 1.7,
    mood: 'a clean sunrise sky, pale and smooth, top to bottom' },
  // orange 32% / purple 29% / red 21% — radial, mid, 6.9
  halo: { colors: ['orange', 'purple', 'red'], direction: 'radial', tone: 'mid', busy: 6.9,
    mood: 'a warm glow burning out from the centre' },
  // green 22% / blue 17% / orange 11% — none, light, 7.7
  spectrum: { colors: ['green', 'blue', 'orange'], direction: 'none', tone: 'light', busy: 7.7,
    mood: 'a full colour wheel sweeping around' },
  // blue 64% / teal 13% / purple 10% — vertical, dark, 10.4
  aurora: { colors: ['blue', 'teal', 'purple'], direction: 'vertical', tone: 'dark', busy: 10.4,
    mood: 'northern-lights ribbons on a dark sky' },
  // white 56% / blue 34% — none, light, 14.4
  frosted: { colors: ['white', 'blue'], direction: 'none', tone: 'light', busy: 14.4,
    mood: 'etched frosted glass, icy and bright' },
  // magenta 45% / yellow 23% / orange 11% — vertical, mid, 4.8
  sunset: { colors: ['magenta', 'yellow', 'orange'], direction: 'vertical', tone: 'mid', busy: 4.8,
    mood: 'a warm sky at dusk, horizon running top to bottom' },
}

/**
 * How far a re-measure may wander from the recorded numbers before the guard
 * calls it drift.
 *
 * Generous on `busy` because it is a raw energy number that moves with any
 * change to noise or seeding; strict on direction and tone, which are the
 * claims a person would actually notice being wrong — and the ones the recipe
 * call reasons about.
 */
export const DRIFT_TOLERANCE = { busy: 0.6 }

/** A measurement of a real render, in the shape the checkers produce. */
export interface LookMeasurement {
  colors: string[]
  direction: string
  tone: string
  busy: number
}

/**
 * Does a freshly-measured render still match what we say about it?
 *
 * The descriptors are the one place a human judgement enters this data, and a
 * preset can be re-seeded, re-authored or re-tuned by someone who has never read
 * this file. So the claims are checkable, and this is what checks them — fed a
 * measurement taken with the same checkers that produced the originals.
 *
 * Direction and tone are held EXACTLY: they are the claims the recipe call
 * reasons about ("sunset runs vertically") and the ones a person would notice
 * being wrong. Colours are held loosely — at least one of the named colours must
 * still be among the render's dominant ones, because a re-seed can reorder a
 * palette without changing what the look is. `busy` is a raw energy number that
 * moves with any noise change, so it gets a proportional band.
 *
 * Returns the list of drifted fields — empty means the descriptor still tells
 * the truth.
 */
export function checkLookDrift(name: string, measured: LookMeasurement): string[] {
  const d = LOOK_DESCRIPTORS[name]
  if (!d) return ['unknown look']
  const drift: string[] = []
  if (measured.direction !== d.direction) drift.push(`direction ${d.direction} → ${measured.direction}`)
  if (measured.tone !== d.tone) drift.push(`tone ${d.tone} → ${measured.tone}`)
  if (!d.colors.some(c => measured.colors.includes(c))) {
    drift.push(`colours ${d.colors.join('/')} → ${measured.colors.join('/')}`)
  }
  const band = Math.max(2, d.busy * DRIFT_TOLERANCE.busy)
  if (Math.abs(measured.busy - d.busy) > band) drift.push(`busy ${d.busy} → ${measured.busy}`)
  return drift
}


// ── which looks the model may compose FROM ──────────────────────────────────
//
// Julien's call after the first real-model runs: only the VERSATILE layout
// families belong on the recipe menu. Conic, stripe, orbit and stack looks are
// "too specific and never really fit the vision". They stay first-class in the
// STUDIO — the user can still pick any of them by hand — this narrows the
// AGENT's menu and nothing else.
//
// The full layout union, and where each value falls:
//
//   ramp        → LINEAR   offered   (the studio's "Linear")
//   radialRamp  → RADIAL   offered   (the studio's "Radial")
//   curve       → CURVE    offered
//   liquid      → LIQUID   offered
//   mesh        → MESH     offered
//   linear      → stripes  withheld  (the studio's "Linear stripes")
//   radial      → stripes  withheld  (the studio's "Radial stripes")
//   conic       → conic    withheld
//   orbit       → orbit    withheld
//   stack       → stack    withheld
//
export const TAKE_BASE_LAYOUT_FAMILIES: Record<string, readonly string[]> = {
  LINEAR: ['ramp'],
  RADIAL: ['radialRamp'],
  CURVE: ['curve'],
  LIQUID: ['liquid'],
  MESH: ['mesh'],
}

/** Flattened, for the eligibility check. */
export const TAKE_BASE_LAYOUTS: readonly string[] = Object.values(TAKE_BASE_LAYOUT_FAMILIES).flat()

/**
 * The layouts deliberately kept OFF the agent's menu — named rather than merely
 * absent, so the partition is a fact the build checks instead of a claim in the
 * comment above.
 *
 * Every member of `LAYOUTS` must appear in exactly one of these two lists. An
 * eleventh layout value therefore fails a spec rather than silently landing on
 * whichever side the filter happens to put it — which, since the filter is an
 * allowlist, would be the withheld side, and a new versatile family would go
 * missing from the menu with nobody told.
 */
export const WITHHELD_LAYOUTS: readonly string[] = ['linear', 'radial', 'conic', 'orbit', 'stack']

/** The seed eligibility is measured with. Fixed on purpose: which family a
 *  preset belongs to is a look-defining fact that must not depend on a roll, and
 *  pinning it makes the menu identical on every load. */
const ELIGIBILITY_SEED = '#menu'

/**
 * Is this preset's look one the recipe menu offers?
 *
 * DERIVED, never a hand-typed name list — the shared-catalog lesson. Eligibility
 * is the MEASURED `canvas.layout` of the preset's own materialized config, so a
 * preset re-authored into a different family leaves or joins the menu on its
 * own, and a NEW preset in an offered family is admitted without anyone editing
 * this file.
 */
export function isTakeBaseEligible(name: string): boolean {
  const layout = buildGradientPreset(name, ELIGIBILITY_SEED)?.canvas?.layout
  return !!layout && TAKE_BASE_LAYOUTS.includes(layout)
}

/** Every preset with a descriptor. The STUDIO-side list — the drift guard still
 *  covers all of them, because they are all still reachable by hand. */
export const ALL_LOOK_NAMES: string[] = Object.keys(LOOK_DESCRIPTORS)

/**
 * The looks the model may compose from.
 *
 * Narrowing this ONE list narrows everything downstream at once: the menu prose,
 * the base a recipe may name, and what `salvageRecipes` accepts — a recipe
 * naming a withheld base is dropped by the same check that has always dropped an
 * unknown one.
 */
export const LOOK_NAMES: string[] = ALL_LOOK_NAMES.filter(isTakeBaseEligible)

/** One line per look, for the prompt. Deliberately prose, not JSON: it is a menu
 *  a reader could use, which is the whole point of the redesign. */
export function describeLook(name: string): string | null {
  const d = LOOK_DESCRIPTORS[name]
  if (!d) return null
  const dir = d.direction === 'none' ? 'no strong direction' : `${d.direction} direction`
  return `${name} — ${d.mood}. Mostly ${d.colors.join(' and ')}; ${dir}; ${d.tone} overall.`
}

/** The whole menu, in declaration order. */
export function lookMenu(): string {
  return LOOK_NAMES.map(describeLook).filter(Boolean).join('\n')
}
