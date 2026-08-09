// Round-2b Task 1 — staging image support: `Staging.supports.needsImage`,
// `StagingInput.image`/`generate()`'s `opts.image` threading, the
// `tierImage` placement helper, and `surprise()`'s needsImage pool filter.
//
// No REAL staging consumes `image` yet (Round-2b Tasks 3–4 are the first
// callers), so the threading + pool-filter tests register a synthetic
// "probe" staging directly into the exported `STAGINGS` array for the
// duration of one test, then remove it — the only way to exercise
// `generate()`/`surprise()`'s real staging-selection code paths (which read
// `STAGINGS` by module-level reference) without waiting on a later task.
// `afterEach` restores the array unconditionally so a failing assertion
// can't leak a probe into any other test in this file.
import { afterEach, describe, expect, it } from 'vitest'
import {
  STAGINGS, tierImage, type Staging, type StagingInput, type StagingResult,
} from '~~/shared/template-grid/generate/stagings'
import { generate, surprise } from '~~/shared/template-grid/generate/generate'
import type { ImageElementV2, TemplateV3, Tiers } from '~~/shared/template-grid/types'

function base(): TemplateV3 {
  return {
    version: 3, id: 't', name: 'T', master: '3x4',
    formats: { '3x4': { w: 1080, h: 1440 } },
    grid: { gutter: 16, margin: 48, baseline: 8, columns: 12, rows: 16 },
    typeScale: { base: 14, ratio: 1.5 },
    background: {},
    elements: [],
    sections: [],
    tiers: {
      hero: { content: 'MAT + FEST' },
      anchor: { content: '15—26 June' },
      support: { content: 'Street food' },
      fineprint: { content: 'Slakthus' },
    },
  }
}

const originalStagings = [...STAGINGS]
afterEach(() => {
  STAGINGS.length = 0
  STAGINGS.push(...originalStagings)
})

describe('tierImage helper', () => {
  it('builds the standard staged-image shape: id, origin, focal, fit:cover', () => {
    const el = tierImage('0', '{{ props.image_layer_1 }}',
      { col: 1, colSpan: 6, row: 1, rowSpan: 8 }, 1)
    expect(el).toEqual({
      id: 'img_0',
      type: 'image',
      content: '{{ props.image_layer_1 }}',
      priority: 1,
      region: { col: 1, colSpan: 6, row: 1, rowSpan: 8 },
      origin: 'staging',
      focal: { x: 0.5, y: 0.5 },
      style: { fit: 'cover' },
    })
  })

  it('id is img_<slot> for an arbitrary slot name, not just numeric', () => {
    const el = tierImage('right', 'x', { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1)
    expect(el.id).toBe('img_right')
  })

  it('passes bleed through when requested, omits it when not', () => {
    const bled = tierImage('0', 'x', { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1, { bleed: true })
    expect(bled.bleed).toBe(true)
    const notBled = tierImage('0', 'x', { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1)
    expect(notBled.bleed).toBeUndefined()
  })

  it('passes overhang through when requested, omits it when not', () => {
    const hung = tierImage('0', 'x', { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1, { overhang: true })
    expect(hung.overhang).toBe(true)
    const flat = tierImage('0', 'x', { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1)
    expect(flat.overhang).toBeUndefined()
  })
})

describe('generate(): opts.image threads into StagingInput.image', () => {
  const PROBE_ID = 'probe_image_capture'

  function registerCaptureProbe(): { captured: (string | undefined)[] } {
    const captured: (string | undefined)[] = []
    const probe: Staging = {
      id: PROBE_ID, name: 'Probe', blurb: 'test-only capture of StagingInput.image',
      knobs: [],
      compose(input: StagingInput): StagingResult {
        captured.push(input.image)
        // Round-trip through the real tierImage helper when an image token
        // is present, so this also proves a composer CAN place it — the
        // whole point of the threading.
        const els = input.image
          ? [tierImage('probe', input.image, { col: 1, colSpan: 1, row: 1, rowSpan: 1 }, 1)]
          : []
        return { elements: els }
      },
    }
    STAGINGS.push(probe)
    return { captured }
  }

  it('with an image token: the composer receives it in StagingInput.image and can place it', () => {
    const { captured } = registerCaptureProbe()
    const t = generate(base(), { staging: PROBE_ID, theme: 'paper', seed: 1, image: '{{ props.image_layer_1 }}' })
    expect(captured).toEqual(['{{ props.image_layer_1 }}'])
    const img = t.elements.find(e => e.id === 'img_probe') as ImageElementV2 | undefined
    expect(img).toBeTruthy()
    expect(img!.content).toBe('{{ props.image_layer_1 }}')
  })

  it('without an image token: StagingInput.image is undefined, nothing placed', () => {
    const { captured } = registerCaptureProbe()
    const t = generate(base(), { staging: PROBE_ID, theme: 'paper', seed: 1 })
    expect(captured).toEqual([undefined])
    expect(t.elements.find(e => e.id === 'img_probe')).toBeUndefined()
  })
})

describe('surprise(): pool excludes supports.needsImage stagings when no image is wired', () => {
  const NEEDS_IMAGE_ID = 'probe_needs_image'
  const NO_IMAGE_ID = 'probe_no_image'

  function emptyStaging(id: string, needsImage: boolean): Staging {
    return {
      id, name: id, blurb: 'test-only',
      knobs: [],
      ...(needsImage ? { supports: { needsImage: true } } : {}),
      compose: () => ({ elements: [] }),
    }
  }

  /** Replace STAGINGS wholesale with exactly these two — forces a
   *  deterministic outcome (pool size 1 after filtering) regardless of the
   *  seeded pick's draw, rather than needing to scan many seeds. */
  function installTwoStagingPool() {
    STAGINGS.length = 0
    STAGINGS.push(emptyStaging(NO_IMAGE_ID, false), emptyStaging(NEEDS_IMAGE_ID, true))
  }

  it('no image wired: surprise NEVER lands on the needsImage staging, across many seeds', () => {
    installTwoStagingPool()
    for (let seed = 1; seed <= 25; seed++) {
      const t = generate(base(), { staging: NO_IMAGE_ID, theme: 'paper', seed })
      const rolled = surprise(t) // ctx.image absent
      expect(rolled.gen?.staging).toBe(NO_IMAGE_ID)
    }
  })

  it('image wired: surprise CAN select the needsImage staging (pool includes it)', () => {
    installTwoStagingPool()
    // Pool has both candidates once an image is wired — scan seeds until the
    // seeded pick actually draws the needsImage one, proving it's reachable
    // (not just "didn't crash"). Deterministic per seed; if this ever came
    // back false across the whole range the filter would be over-excluding.
    let sawNeedsImage = false
    for (let seed = 1; seed <= 25; seed++) {
      const t = generate(base(), { staging: NO_IMAGE_ID, theme: 'paper', seed })
      const rolled = surprise(t, { image: '{{ props.image_layer_1 }}' })
      expect([NO_IMAGE_ID, NEEDS_IMAGE_ID]).toContain(rolled.gen?.staging)
      if (rolled.gen?.staging === NEEDS_IMAGE_ID) sawNeedsImage = true
    }
    expect(sawNeedsImage).toBe(true)
  })

  it('is deterministic: the same seed + same (absent) image always picks the same staging', () => {
    installTwoStagingPool()
    const t = generate(base(), { staging: NO_IMAGE_ID, theme: 'paper', seed: 7 })
    const a = surprise(t)
    const b = surprise(t)
    expect(a.gen?.staging).toBe(b.gen?.staging)
    expect(a.gen?.seed).toBe(b.gen?.seed)
  })

  it('a needsImage staging that is LOCKED is still used even without an image (lock beats the pool filter)', () => {
    installTwoStagingPool()
    const t = generate(base(), { staging: NEEDS_IMAGE_ID, theme: 'paper', seed: 1 })
    const locked: TemplateV3 = { ...t, gen: { ...t.gen!, locks: { staging: true } } }
    const rolled = surprise(locked) // no image, but staging is locked
    expect(rolled.gen?.staging).toBe(NEEDS_IMAGE_ID)
  })

  it('degenerate case: every staging needs an image and none is wired — falls back to the unfiltered pool instead of crashing', () => {
    STAGINGS.length = 0
    STAGINGS.push(emptyStaging(NEEDS_IMAGE_ID, true))
    const t = generate(base(), { staging: NEEDS_IMAGE_ID, theme: 'paper', seed: 1 })
    expect(() => surprise(t)).not.toThrow()
    const rolled = surprise(t)
    expect(rolled.gen?.staging).toBe(NEEDS_IMAGE_ID)
  })
})

// Sanity: confirm every staging OUTSIDE Family C is untouched by this task —
// none of them declare needsImage, matching the family tables (Family A/B/D
// don't require an image; only Family C does — built in round-2b Task 4,
// after this task's own probe-based tests above were written. `[...
// originalStagings]` reads whatever's in the live `STAGINGS` registry at
// THIS FILE's import time, so it now includes Family C's four real
// stagings too — excluded here since needsImage:true is exactly what they're
// supposed to declare).
const FAMILY_C_IDS = new Set(['cover', 'lockup', 'band_header', 'band_footer'])
describe('existing stagings: none declare supports.needsImage (unaffected by this task)', () => {
  for (const s of originalStagings.filter(s => !FAMILY_C_IDS.has(s.id))) {
    it(`${s.id}: supports.needsImage is not set`, () => {
      expect(s.supports?.needsImage).toBeFalsy()
    })
  }
})
