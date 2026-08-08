import type { BrandKit, ElementV2, TemplateV3 } from '../types'
import { makeRng } from './rng'
import { resolveKnobs } from './knobs'
import { getStaging, STAGINGS, type StagingResult } from './stagings'
import { getSurface, SURFACES } from './surfaces'
import { validateGenerated } from './validate'

interface GenOpts {
  staging: string
  surface: string
  seed: number
  knobs?: Record<string, unknown>
  brand?: BrandKit
  image?: string
}

/** Text elements the surface says should read light get a light foreground; the
 *  tier's own type still wins if it set a colour. */
function applyContrast(els: ElementV2[], contrast: 'light' | 'dark'): ElementV2[] {
  const fg = contrast === 'dark' ? '{{ brand.foreground }}' : '{{ brand.secondary }}'
  return els.map(e => e.type === 'text'
    ? { ...e, style: { color: fg, ...e.style } }
    : e)
}

/** Deterministically produce a generated TemplateV3 from the axis tuple. */
export function generate(template: TemplateV3, opts: GenOpts): TemplateV3 {
  const staging = getStaging(opts.staging) ?? STAGINGS[0]!
  const surface = getSurface(opts.surface) ?? SURFACES[0]!
  const cols = template.grid.columns ?? 12
  const rows = template.grid.rows ?? 16
  const tiers = template.tiers ?? {}
  const masterFormat = template.formats[template.master]
  const canvas = { w: masterFormat?.w ?? 1080, h: masterFormat?.h ?? 1080 }

  // Surface first (its own salted stream), then staging with knob re-roll on
  // validation failure.
  const surf = surface.apply({
    rng: makeRng(opts.seed, 'surface'),
    knobs: resolveKnobs(surface.knobs, makeRng(opts.seed, 'surface-knobs')),
    image: opts.image,
  })

  let stagingResult: StagingResult = { elements: [] }
  let knobs: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 8; attempt++) {
    const rng = makeRng(opts.seed + attempt, 'staging-knobs')
    knobs = resolveKnobs(staging.knobs, rng, attempt === 0 ? (opts.knobs ?? {}) : {})
    stagingResult = staging.compose({ tiers, cols, rows, canvas, rng: makeRng(opts.seed + attempt, 'staging'), knobs, brand: opts.brand })
    if (validateGenerated(stagingResult, cols, rows).ok) break
  }
  const staged: ElementV2[] = applyContrast(stagingResult.elements, surf.contrast)

  const preserved = template.elements.filter(e => e.origin !== 'staging')
  return {
    ...template,
    background: { ...surf.background },
    elements: [...staged, ...preserved],
    order: [...staged.map(e => e.id), ...preserved.map(e => e.id)],
    gen: {
      staging: staging.id,
      surface: surface.id,
      seed: opts.seed,
      knobs,
      locks: template.gen?.locks,
    },
  }
}

/** Derive the next seed from the current one (deterministic, no Math.random). */
function nextSeed(seed: number): number {
  return (makeRng(seed, 'reseed').int(1_000_000) + 1)
}

/** Re-roll knobs (and unlocked axes stay put) under a new seed. */
export function shuffle(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = template.gen ?? { staging: STAGINGS[0]!.id, surface: SURFACES[0]!.id, seed: 1 }
  return generate(template, { staging: gen.staging, surface: gen.surface, seed: nextSeed(gen.seed), brand: ctx.brand, image: ctx.image })
}

/** Re-roll BOTH axes under a new seed, honouring per-axis locks. */
export function surprise(template: TemplateV3, ctx: { brand?: BrandKit; image?: string } = {}): TemplateV3 {
  const gen = template.gen
  const seed = nextSeed(gen?.seed ?? 1)
  const pick = makeRng(seed, 'axes')
  const staging = gen?.locks?.staging ? gen.staging : pick.pick(STAGINGS).id
  // Surface pick respects the presence of an image for image-only surfaces.
  const pool = ctx.image ? SURFACES : SURFACES.filter(s => !s.needsImage)
  const surface = gen?.locks?.surface ? gen!.surface : pick.pick(pool).id
  return generate(template, { staging, surface, seed, brand: ctx.brand, image: ctx.image })
}
