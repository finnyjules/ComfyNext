import type { BrandKit, ElementV2, GenState, TemplateV3 } from '../types'
import { fineGridDims } from '../grid'
import { effectiveBrand } from '../../brand/resolve'
import { makeRng } from './rng'
import { resolveKnobs } from './knobs'
import { getStaging, STAGINGS, type StagingResult } from './stagings'
import { getTheme, THEMES, resolveInk, contrastRatio, SURFACE_TO_THEME } from './themes'
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
  /** Unused by theme generation (no image gating — that concept died with
   *  duotone-photo) but kept accepted so callers threading a wired image for
   *  OTHER purposes don't need a special-cased call shape. */
  image?: string
}

const DEFAULT_THEME_ID = 'paper'

/** Round-1 templates persisted `gen.surface`; round-2 reads `gen.theme`. One
 *  migration point — maps a stored gen (either shape) forward through
 *  `SURFACE_TO_THEME` so a legacy doc regenerates without erroring. Called at
 *  the top of `generate()`/`shuffle()`/`surprise()`. */
export function migrateGen(gen: (GenState & { surface?: string }) | undefined): GenState | undefined {
  if (!gen || gen.theme) return gen as GenState | undefined
  const legacySurface = gen.surface
  if (!legacySurface) return gen as GenState
  const { surface: _surface, ...rest } = gen
  return { ...rest, theme: SURFACE_TO_THEME[legacySurface] ?? DEFAULT_THEME_ID }
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
    stagingResult = staging.compose({ tiers, cols, rows, canvas, rng: makeRng(opts.seed + attempt, 'staging'), knobs, brand: opts.brand })
    if (validateGenerated(stagingResult, cols, rows).ok) break
  }

  // Stamp on change only: a theme switch (or a brand missing any of the
  // three keys) writes background/foreground/accent from the theme. Same-
  // theme regeneration (Shuffle, knob/tier edits) never rewrites them — a
  // user's hand-edited brand colours survive.
  const priorThemeId = gen?.theme
  const brandDefaults = template.brand ?? {}
  const needsStamp = opts.theme !== priorThemeId
    || brandDefaults.background == null || brandDefaults.foreground == null || brandDefaults.accent == null
  const brand: BrandKit = needsStamp
    ? { ...brandDefaults, background: theme.field, foreground: resolveInk(theme.field), accent: theme.defaultAccent }
    : brandDefaults

  // Luminance guard: check the EFFECTIVE merge (this brand ← the active/wired
  // opts.brand) — a user's brand kit can clash with the theme even when the
  // theme's own field/ink pairing is fine on its own.
  const effective = effectiveBrand(brand, opts.brand)
  const effectiveField = effective.background ?? theme.field
  const effectiveInk = effective.foreground ?? resolveInk(effectiveField)
  const ink = contrastRatio(effectiveInk, effectiveField) < 3
    ? resolveInk(effectiveField)
    : '{{ brand.foreground }}'

  const staged: ElementV2[] = applyInk(stagingResult.elements, { accentOnHero: opts.accentOnHero, ink })

  const preserved = template.elements.filter(e => e.origin !== 'staging')
  return {
    ...template,
    brand,
    background: { fill: '{{ brand.background }}' },
    elements: [...staged, ...preserved],
    order: [...staged.map(e => e.id), ...preserved.map(e => e.id)],
    gen: {
      staging: staging.id,
      theme: theme.id,
      seed: opts.seed,
      knobs,
      locks: gen?.locks,
      ...(opts.accentOnHero !== undefined ? { accentOnHero: opts.accentOnHero } : {}),
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
 *  is all 7 themes — no image gating, that concept died with duotone-photo. */
export function surprise(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = migrateGen(template.gen)
  const seed = nextSeed(gen?.seed ?? 1)
  const pick = makeRng(seed, 'axes')
  const staging = gen?.locks?.staging ? gen.staging : pick.pick(STAGINGS).id
  const theme = gen?.locks?.theme ? (gen!.theme ?? DEFAULT_THEME_ID) : pick.pick(THEMES).id
  return generate(template, { staging, theme, seed, accentOnHero: gen?.accentOnHero, brand: ctx.brand, image: ctx.image })
}
