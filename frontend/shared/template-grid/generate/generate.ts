import type { BrandKit, ElementV2, GenState, TemplateV3 } from '../types'
import { fineGridDims } from '../grid'
import { effectiveBrand } from '../../brand/resolve'
import { effectiveOrder } from '../sections'
import { makeRng } from './rng'
import { resolveKnobs } from './knobs'
import { getStaging, STAGINGS, type StagingResult } from './stagings'
import { BRAND_AXIS_KEYS, getTheme, THEMES, resolveInk, contrastRatio, themeBrandDefaults, SURFACE_TO_THEME } from './themes'
import { validateGenerated } from './validate'

interface GenOpts {
  staging: string
  theme: string
  seed: number
  knobs?: Record<string, unknown>
  brand?: BrandKit
  /** Colour the hero tier (`tier_hero_0`) in the theme's accent instead of
   *  the default ink. */
  accentOnHero?: boolean
  /** The wired image-socket CONTENT token (e.g. `'{{ props.image_layer_1
   *  }}'`), or undefined when no image is wired — threaded straight into
   *  `StagingInput.image` (Family B/C stagings place it via `tierImage`) and
   *  read by `surprise()`'s pool filter to exclude `supports.needsImage`
   *  stagings when absent. Theme selection itself still doesn't gate on it
   *  (no image gating there — that concept died with duotone-photo). */
  image?: string
}

const DEFAULT_THEME_ID = 'paper'

/** Rename the nested round-1 axis lock `locks.surface` → `locks.theme`,
 *  dropping the stale key. Idempotent: a locks object already carrying
 *  `theme` is returned as-is (its value wins over any stray `surface`). */
function migrateLocks(locks: GenState['locks'] | undefined): GenState['locks'] | undefined {
  const raw = locks as (Record<string, boolean> | undefined)
  if (!raw || !('surface' in raw)) return locks
  const { surface, ...rest } = raw
  return { ...rest, theme: raw.theme ?? surface }
}

/** Round-1 templates persisted `gen.surface` (and `gen.locks.surface`);
 *  round-2 reads `gen.theme`/`gen.locks.theme`. One migration point — maps a
 *  stored gen (either shape) forward through `SURFACE_TO_THEME` so a legacy
 *  doc regenerates without erroring, and its axis lock survives the rename.
 *  Called at the top of `generate()`/`shuffle()`/`surprise()`. */
export function migrateGen(gen: (GenState & { surface?: string }) | undefined): GenState | undefined {
  if (!gen) return gen
  if (gen.theme) return { ...gen, locks: migrateLocks(gen.locks) } as GenState
  const legacySurface = gen.surface
  if (!legacySurface) return { ...gen, locks: migrateLocks(gen.locks) } as GenState
  const { surface: _surface, ...rest } = gen
  return { ...rest, theme: SURFACE_TO_THEME[legacySurface] ?? DEFAULT_THEME_ID, locks: migrateLocks(gen.locks) }
}

/** Inject the staged text ink post-compose: `ink` (a `{{ brand.foreground }}`
 *  token, or a literal hex when the luminance guard trips) by default;
 *  `tier_hero_0` gets `{{ brand.accent }}` instead when `accentOnHero`. The
 *  tier's own `type.color` (already folded into `e.style` by `tierText`)
 *  always wins — it's spread AFTER our default. */
function applyInk(els: ElementV2[], opts: { accentOnHero?: boolean; ink: string }): ElementV2[] {
  return els.map((e) => {
    if (e.type !== 'text') return e
    const isAccentHero = Boolean(opts.accentOnHero) && e.id === 'tier_hero_0'
    const fg = isAccentHero ? '{{ brand.accent }}' : opts.ink
    return { ...e, style: { color: fg, ...e.style } }
  })
}

/** Deterministically produce a generated TemplateV3 from the axis tuple. */
export function generate(template: TemplateV3, opts: GenOpts): TemplateV3 {
  const gen = migrateGen(template.gen)
  const staging = getStaging(opts.staging) ?? STAGINGS[0]!
  const theme = getTheme(opts.theme) ?? getTheme(DEFAULT_THEME_ID)!
  const tiers = template.tiers ?? {}
  const masterFormat = template.formats[template.master]
  const canvas = { w: masterFormat?.w ?? 1080, h: masterFormat?.h ?? 1080 }
  // Stagings author element regions in the SAME grid coordinate space that
  // `resolveFormat` will later interpret them in — `fineGridDims` of the
  // master format (the exact `masterDims` resolve.ts computes: the v2
  // per-class cell grid, or v3's fixed baseline-derived grid). A mismatch
  // here silently collapses regions: `remapRegion`'s scale factor is
  // (target dims / masterDims), so composing in a coordinate space that
  // doesn't match masterDims either shrinks every region toward a sliver
  // (masterDims too large — e.g. a fixed 12×16 authoring grid read against a
  // 78×78 v3 fine grid puts a "full width" colSpan:12 element at ~15% of
  // the canvas) or over-clamps it (masterDims too small). `template.grid.
  // columns`/`rows`, when explicitly set, still win via `fineGridDims`.
  const { cols, rows } = masterFormat ? fineGridDims(template, masterFormat) : { cols: 12, rows: 16 }

  let stagingResult: StagingResult = { elements: [] }
  let knobs: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = makeRng(opts.seed + attempt, 'staging-knobs')
    knobs = resolveKnobs(staging.knobs, rng, attempt === 0 ? (opts.knobs ?? {}) : {})
    stagingResult = staging.compose({ tiers, cols, rows, canvas, rng: makeRng(opts.seed + attempt, 'staging'), knobs, brand: opts.brand, image: opts.image })
    if (validateGenerated(stagingResult, cols, rows).ok) break
  }

  // Stamp on change: an explicit theme switch overwrites every un-pinned
  // axis key from the theme; same-theme regeneration (Shuffle, knob/tier
  // edits) only backfills keys the brand is MISSING (clearing one key in the
  // popover then shuffling no longer clobbers the other two — round-2a fix).
  // A key in `gen.brandEdits` (hand-edited via setBrandOverride/setBrand) is
  // PINNED: no trigger here — including a same-call theme switch during
  // Surprise — ever overwrites it. `setTheme` (an explicit theme PICK, not a
  // roll) clears `brandEdits` itself before calling generate(), adopting the
  // new theme's system wholesale.
  const priorThemeId = gen?.theme
  const brandDefaults = template.brand ?? {}
  const themeChanged = opts.theme !== priorThemeId
  const brandEdits = new Set(gen?.brandEdits ?? [])
  const themeDefaults = themeBrandDefaults(theme)
  const brand: BrandKit = { ...brandDefaults }
  for (const key of BRAND_AXIS_KEYS) {
    if (brandEdits.has(key)) continue
    if (themeChanged || brandDefaults[key] == null) brand[key] = themeDefaults[key]
  }

  // Luminance guard: check the EFFECTIVE merge (this brand ← the active/wired
  // opts.brand) — a user's brand kit can clash with the theme even when the
  // theme's own field/ink pairing is fine on its own. `contrastRatio` returns
  // NaN when either colour isn't a hex `relLuminance` can parse (free-text
  // Brand-popover values, rgb()/gradients, a StudioColor #rrggbbaa is fine —
  // relLuminance strips its alpha); a NaN comparison is always false, but
  // `Number.isFinite` makes the "skip an unparseable value" intent explicit
  // rather than relying on that fallthrough.
  const effective = effectiveBrand(brand, opts.brand)
  const effectiveField = effective.background ?? theme.field
  const effectiveInk = effective.foreground ?? resolveInk(effectiveField)
  const ratio = contrastRatio(effectiveInk, effectiveField)
  const ink = Number.isFinite(ratio) && ratio < 3
    ? resolveInk(effectiveField)
    : '{{ brand.foreground }}'

  const staged: ElementV2[] = applyInk(stagingResult.elements, { accentOnHero: opts.accentOnHero, ink })

  // Z-order: rebuild only the staged block. The previous relative order of
  // every non-staging id (freeform elements + sections) is preserved — a
  // hand-arranged z-order (e.g. a freeform photo sent to back) survives a
  // regeneration instead of jumping back to front. The staged block composes
  // in `staged`'s own order and reoccupies wherever staged ids previously
  // sat (front-of-list for a template that had none yet — e.g. first
  // generate() call, or every prior staged element was removed).
  const prevOrder = effectiveOrder(template)
  const prevStagedIds = new Set(template.elements.filter(e => e.origin === 'staging').map(e => e.id))
  const nonStagedOrder = prevOrder.filter(id => !prevStagedIds.has(id))
  const firstStagedIdx = prevOrder.findIndex(id => prevStagedIds.has(id))
  const insertAt = firstStagedIdx < 0
    ? 0
    : prevOrder.slice(0, firstStagedIdx).filter(id => !prevStagedIds.has(id)).length
  const newStagedIds = staged.map(e => e.id)
  const order = [...nonStagedOrder.slice(0, insertAt), ...newStagedIds, ...nonStagedOrder.slice(insertAt)]

  const preserved = template.elements.filter(e => e.origin !== 'staging')
  return {
    ...template,
    brand,
    background: { fill: '{{ brand.background }}' },
    elements: [...staged, ...preserved],
    order,
    gen: {
      staging: staging.id,
      theme: theme.id,
      seed: opts.seed,
      knobs,
      locks: gen?.locks,
      ...(opts.accentOnHero !== undefined ? { accentOnHero: opts.accentOnHero } : {}),
      ...(gen?.brandEdits?.length ? { brandEdits: gen.brandEdits } : {}),
    },
  }
}

/** Derive the next seed from the current one (deterministic, no Math.random). */
function nextSeed(seed: number): number {
  return (makeRng(seed, 'reseed').int(1_000_000) + 1)
}

/** Re-roll knobs (and unlocked axes stay put) under a new seed. */
export function shuffle(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = migrateGen(template.gen) ?? { staging: STAGINGS[0]!.id, theme: DEFAULT_THEME_ID, seed: 1 }
  return generate(template, {
    staging: gen.staging, theme: gen.theme ?? DEFAULT_THEME_ID, seed: nextSeed(gen.seed),
    accentOnHero: gen.accentOnHero, brand: ctx.brand, image: ctx.image,
  })
}

/** Re-roll BOTH axes under a new seed, honouring per-axis locks. Theme pool
 *  is all 7 themes — no image gating, that concept died with duotone-photo.
 *  The STAGING pool, unlike theme, DOES gate on image presence: a
 *  `supports.needsImage` staging (Family C — the photo IS the composition)
 *  is excluded when `ctx.image` is absent, so a no-image roll never lands on
 *  one that would render an empty/placeholder field. The filter runs BEFORE
 *  the seeded pick (same seed + same filtered pool ⇒ same staging every
 *  time) — deterministic, same shape as the round-1 needsImage filter for
 *  surfaces. Falls back to the unfiltered list only in the degenerate case
 *  where filtering would empty the pool (every staging needs an image and
 *  none is wired) rather than crash on an empty pick. */
export function surprise(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = migrateGen(template.gen)
  const seed = nextSeed(gen?.seed ?? 1)
  const pick = makeRng(seed, 'axes')
  const stagingPool = STAGINGS.filter(s => ctx.image || !s.supports?.needsImage)
  const staging = gen?.locks?.staging
    ? gen.staging
    : pick.pick(stagingPool.length ? stagingPool : STAGINGS).id
  const theme = gen?.locks?.theme ? (gen!.theme ?? DEFAULT_THEME_ID) : pick.pick(THEMES).id
  return generate(template, { staging, theme, seed, accentOnHero: gen?.accentOnHero, brand: ctx.brand, image: ctx.image })
}
