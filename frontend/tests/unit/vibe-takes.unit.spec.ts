/**
 * Four-takes Task 1: /api/vibe learns to answer in four takes.
 *
 * Back-compat is the contract — when `variants` is absent, the request body
 * sent to Anthropic and the response shape returned to the client must stay
 * byte-identical to today. These specs pin that shape as a characterization
 * test BEFORE the variants branch exists, then cover the new branch.
 */
import { describe, it, expect } from 'vitest'
import { describeControls } from '~/lib/spacetype/controlDescriptor'
import type { ControlSpec } from '~/lib/spacetype/effect'
import {
  VIBE_SCHEMA,
  TAKES_SCHEMA,
  VARIANTS_UNSUPPORTED,
  TAKES_UNSALVAGEABLE,
  buildVibePrompt,
  parseTakesResponse,
} from '~/lib/vibePrompt'
import { buildVibeRequestBody, parseVariants, shapeTakesResponse } from '../../server/api/vibe.post'

const CONTROLS: ControlSpec[] = [
  { key: 'depth', label: 'Depth', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.5, hint: 'higher = deeper' },
  { key: 'palette', label: 'Palette', kind: 'select', options: ['cool', 'warm', 'mono'], default: 'cool' },
]

describe('back-compat: no variants → today\'s exact shape', () => {
  const described = describeControls(CONTROLS, { depth: 0.7 })
  const prompt = buildVibePrompt(described, 'warmer and deeper', 'Extrude')

  it('prompt is unchanged by the variants param when omitted', () => {
    expect(prompt).toBe(buildVibePrompt(described, 'warmer and deeper', 'Extrude', undefined))
    expect(prompt).not.toContain('MULTIPLE TAKES')
  })

  it('request body is today\'s exact fixture', () => {
    const body = buildVibeRequestBody(prompt)
    expect(body).toEqual({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      output_config: { format: { type: 'json_schema', schema: VIBE_SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    })
  })

  it('schema is still the single-patch VIBE_SCHEMA (strict, no open objects)', () => {
    expect(VIBE_SCHEMA.additionalProperties).toBe(false)
    expect(VIBE_SCHEMA.required).toEqual(['changes', 'rationale'])
  })
})

describe('variants requested: prompt block', () => {
  const described = describeControls(CONTROLS, { depth: 0.7 })

  it('appends a block only when variants is set, base text stays identical', () => {
    const base = buildVibePrompt(described, 'warmer', 'Extrude')
    const withTakes = buildVibePrompt(described, 'warmer', 'Extrude', undefined, 4)
    expect(withTakes.startsWith(base)).toBe(true)
    expect(withTakes).toContain('MULTIPLE TAKES')
  })

  it('names the count and the named-dimension / no-jitter rule', () => {
    const p = buildVibePrompt(described, 'warmer', 'Extrude', undefined, 4)
    expect(p).toMatch(/4/)
    expect(p.toLowerCase()).toContain('named dimension')
    expect(p.toLowerCase()).toContain('jitter')
  })

  it('names the ≤24-char angle-label rule', () => {
    const p = buildVibePrompt(described, 'warmer', 'Extrude', undefined, 4)
    expect(p).toContain('24')
  })

  it('names the out-of-vocab honesty rider ("closest: <look>") without duplicating the full clause', () => {
    const p = buildVibePrompt(described, 'warmer', 'Extrude', undefined, 4)
    expect(p).toContain('closest:')
    // Names the convention, doesn't paste studioTune's full clause text verbatim.
    expect(p).not.toContain('Never present an approximation as an exact match.')
  })

  it('is compact: the appended block is a few hundred chars, not a wall of text', () => {
    const base = buildVibePrompt(described, 'warmer', 'Extrude')
    const withTakes = buildVibePrompt(described, 'warmer', 'Extrude', undefined, 4)
    const blockSize = withTakes.length - base.length
    expect(blockSize).toBeGreaterThan(50)
    expect(blockSize).toBeLessThan(900)
  })
})

describe('TAKES_SCHEMA', () => {
  it('is strict, and does NOT declare minItems/maxItems on takes — structured', () => {
    // outputs rejects `maxItems` outright and only accepts `minItems` values
    // of 0 or 1, so the 2-4 bound can't live on the wire schema. It lives in
    // the array's `description` (below) and is enforced server-side instead,
    // by parseVariants (request) and parseTakesResponse (response) — see the
    // 'variants requested' and 'parseTakesResponse' describe blocks.
    expect(TAKES_SCHEMA.additionalProperties).toBe(false)
    expect(TAKES_SCHEMA.required).toEqual(['takes'])
    expect((TAKES_SCHEMA.properties.takes as any).minItems).toBeUndefined()
    expect((TAKES_SCHEMA.properties.takes as any).maxItems).toBeUndefined()
    expect(TAKES_SCHEMA.properties.takes.description).toMatch(/2 to 4|2–4|2-4/)
    const item = TAKES_SCHEMA.properties.takes.items
    expect(item.additionalProperties).toBe(false)
    expect(item.required).toEqual(['label', 'changes', 'rationale'])
  })
})

describe('buildVibeRequestBody with variants', () => {
  it('switches schema, ups max_tokens, keeps model on the current tier', () => {
    const body: any = buildVibeRequestBody('prompt text', 4)
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.output_config.format.schema).toBe(TAKES_SCHEMA)
    expect(body.max_tokens).toBeGreaterThan(1024)
  })
})

describe('parseVariants: the rejection is NAMED, not just a 400', () => {
  // /api/vibe forwards Anthropic's status verbatim, so a bare 400 from a takes
  // ask is ambiguous. Only THIS route's own field rejection may be quietly
  // re-asked the single-patch way (see useStudioAgent's isVariantsUnsupported);
  // an unnamed 400 must reach the user.
  it('passes 2\u20134 through, absent stays absent (Task 1\u2019s contract)', () => {
    expect(parseVariants(undefined)).toBeUndefined()
    expect(parseVariants(null)).toBeUndefined()
    expect(parseVariants(4)).toBe(4)
    expect(parseVariants(2)).toBe(2)
  })

  it('still rejects out-of-range LOUDLY, with a 400', () => {
    for (const bad of [1, 5, 0, 2.5, '4', true]) {
      expect(() => parseVariants(bad)).toThrow()
      try { parseVariants(bad) }
      catch (e: any) { expect(e.statusCode).toBe(400) }
    }
  })

  it('tags the rejection so a client can tell it from a forwarded model 400', () => {
    try {
      parseVariants(9)
      throw new Error('should have thrown')
    }
    catch (e: any) {
      expect(e.statusMessage).toBe(VARIANTS_UNSUPPORTED)
      expect(e.data?.code).toBe(VARIANTS_UNSUPPORTED)
      // The human-readable message is still the one it always was.
      expect(e.message).toContain('2 and 4')
    }
  })
})

// Live owner report #2: a82fba323 dropped minItems/maxItems from the wire
// schema (Anthropic 400s on both), which made parseTakesResponse the ONLY
// enforcement of shape — and it used to treat any deviation as a hard 502.
// A model returning 5 takes, 1 take, or a 25-char label killed the whole
// request. These specs pin the SALVAGE posture instead: keep what's usable,
// only give up when nothing survives.
describe('parseTakesResponse: server-side count/shape validation', () => {
  const good = (n: number) => ({
    takes: Array.from({ length: n }, (_, i) => ({
      label: `take ${i}`,
      changes: [{ key: 'depth', value: 0.5 }],
      rationale: 'because',
    })),
  })

  it('accepts 2–4 well-shaped takes', () => {
    expect(parseTakesResponse(good(2)).takes).toHaveLength(2)
    expect(parseTakesResponse(good(4)).takes).toHaveLength(4)
  })

  it('rejects non-object / missing takes — nothing to salvage at all', () => {
    expect(parseTakesResponse(null)).toEqual({ takes: [], reason: expect.any(String) })
    expect(parseTakesResponse({})).toEqual({ takes: [], reason: expect.any(String) })
    expect(parseTakesResponse({ takes: 'nope' })).toEqual({ takes: [], reason: expect.any(String) })
    expect(parseTakesResponse({ takes: [] })).toEqual({ takes: [], reason: expect.any(String) })
  })

  it('does NOT clamp values — that stays validatePatch\'s job client-side', () => {
    const takes = good(2)
    takes.takes[0].changes[0].value = 99 // out of the 0..1 slider range
    expect(parseTakesResponse(takes).takes[0]!.changes[0]!.value).toBe(99)
  })
})

describe('parseTakesResponse: salvage tolerance (live owner report #2)', () => {
  it('more than 4 takes: keeps the first 4, drops the rest', () => {
    const raw = {
      takes: Array.from({ length: 5 }, (_, i) => ({
        label: `take ${i}`,
        changes: [{ key: 'depth', value: i / 10 }],
        rationale: 'r',
      })),
    }
    const { takes } = parseTakesResponse(raw)
    expect(takes).toHaveLength(4)
    expect(takes.map(t => t.label)).toEqual(['take 0', 'take 1', 'take 2', 'take 3'])
  })

  it('a label over 24 chars is truncated to 24 with a trailing "…", not rejected', () => {
    const label = 'a'.repeat(30)
    const { takes } = parseTakesResponse({
      takes: [
        { label, changes: [{ key: 'depth', value: 0.5 }], rationale: 'r' },
        { label: 'fine', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
    expect(takes[0]!.label).toHaveLength(24)
    expect(takes[0]!.label.endsWith('…')).toBe(true)
    expect(takes[0]!.label.startsWith('a'.repeat(23))).toBe(true)
  })

  it('an empty/whitespace label is synthesized from the take\'s own rationale, not rejected', () => {
    const { takes } = parseTakesResponse({
      takes: [
        { label: '   ', changes: [{ key: 'depth', value: 0.5 }], rationale: 'pushes it warmer and brighter' },
        { label: 42, changes: [{ key: 'depth', value: 0.6 }], rationale: '' }, // wrong type entirely
        { label: 'fine', changes: [{ key: 'depth', value: 0.7 }], rationale: 'r' },
      ],
    })
    expect(takes[0]!.label).toBe('pushes it warmer')
    expect(takes[1]!.label).toBe('take 2') // no usable rationale either — positional fallback
  })

  it('a malformed changes ENTRY is dropped, the take survives with its other entries', () => {
    const { takes } = parseTakesResponse({
      takes: [
        {
          label: 'mixed',
          changes: [
            { key: 'depth', value: 0.5 }, // good
            { key: 'depth' }, // missing value — dropped
            { value: 0.5 }, // missing key — dropped
            { key: 'palette', value: { nested: true } }, // wrong value type — dropped
            { key: 'palette', value: 'warm' }, // good
          ],
          rationale: 'r',
        },
        { label: 'other', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
    expect(takes[0]!.changes).toEqual([{ key: 'depth', value: 0.5 }, { key: 'palette', value: 'warm' }])
  })

  it('a take whose changes FIELD (not just an entry) is broken is dropped outright', () => {
    const { takes } = parseTakesResponse({
      takes: [
        { label: 'broken', changes: 'not an array', rationale: 'r' },
        { label: 'other', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
    expect(takes).toHaveLength(1)
    expect(takes[0]!.label).toBe('other')
  })

  it('a zero-change take rides along when others have real changes', () => {
    const { takes } = parseTakesResponse({
      takes: [
        { label: 'empty', changes: [{ key: 'nope-not-really-empty-but-all-bad', value: {} }], rationale: 'r' },
        { label: 'real', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
    expect(takes).toHaveLength(2)
    expect(takes.find(t => t.label === 'empty')!.changes).toEqual([])
  })

  it('zero valid takes → empty result with a reason, when EVERY take is empty noise', () => {
    const { takes, reason } = parseTakesResponse({
      takes: [
        { label: 'a', changes: [{ key: 'x', value: {} }], rationale: 'r' },
        { label: 'b', changes: [], rationale: 'r' },
      ],
    })
    expect(takes).toEqual([])
    expect(reason).toEqual(expect.any(String))
  })

  it('exactly 1 valid take survives when the other take is fully unsalvageable', () => {
    const { takes } = parseTakesResponse({
      takes: [
        { label: 'only', changes: [{ key: 'depth', value: 0.5 }], rationale: 'r' },
        { label: 'junk', changes: 'nope', rationale: 'r' },
      ],
    })
    expect(takes).toHaveLength(1)
    expect(takes[0]!.label).toBe('only')
  })

  it('never invents a change: every surviving key/value is byte-identical to the input, never a new one', () => {
    const raw = {
      takes: [
        { label: 'x', changes: [{ key: 'depth', value: 0.42 }, { key: 'palette', value: 'mono' }], rationale: 'r' },
        { label: 'y', changes: [{ key: 'depth', value: 0.9 }], rationale: 'r' },
      ],
    }
    const { takes } = parseTakesResponse(raw)
    // Same length as the well-formed input's changes — nothing added, nothing coerced.
    expect(takes[0]!.changes).toEqual(raw.takes[0]!.changes)
    expect(takes[1]!.changes).toEqual(raw.takes[1]!.changes)
  })
})

describe('shapeTakesResponse: what the route actually answers with', () => {
  it('2–4 salvaged takes → the takes shape', () => {
    const shaped = shapeTakesResponse({
      takes: [
        { label: 'a', changes: [{ key: 'depth', value: 0.5 }], rationale: 'r' },
        { label: 'b', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
    expect(shaped).toEqual({
      takes: [
        { label: 'a', changes: [{ key: 'depth', value: 0.5 }], rationale: 'r' },
        { label: 'b', changes: [{ key: 'depth', value: 0.6 }], rationale: 'r' },
      ],
    })
  })

  it('exactly 1 salvaged take → today\'s single-tune shape, not a takes array of one', () => {
    const shaped: any = shapeTakesResponse({
      takes: [
        { label: 'only', changes: [{ key: 'depth', value: 0.5 }], rationale: 'warmer' },
        { label: 'junk', changes: 'nope', rationale: 'r' },
      ],
    })
    expect(shaped).toEqual({ changes: [{ key: 'depth', value: 0.5 }], rationale: 'warmer' })
    expect(shaped.takes).toBeUndefined()
  })

  it('0 salvaged takes → an error object tagged TAKES_UNSALVAGEABLE, distinct from the generic malformed-JSON 502', () => {
    const shaped: any = shapeTakesResponse({ takes: [] })
    expect(shaped.error).toMatchObject({
      statusCode: 502,
      statusMessage: TAKES_UNSALVAGEABLE,
      data: { code: TAKES_UNSALVAGEABLE },
    })
    expect(shaped.error.data.reason).toEqual(expect.any(String))
    expect(shaped.error.message).not.toBe('Malformed response from Claude')
  })
})
