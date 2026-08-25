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
  buildVibePrompt,
  parseTakesResponse,
} from '~/lib/vibePrompt'
import { buildVibeRequestBody, parseVariants } from '../../server/api/vibe.post'

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

describe('parseTakesResponse: server-side count/shape validation', () => {
  const good = (n: number) => ({
    takes: Array.from({ length: n }, (_, i) => ({
      label: `take ${i}`,
      changes: [{ key: 'depth', value: 0.5 }],
      rationale: 'because',
    })),
  })

  it('accepts 2–4 well-shaped takes', () => {
    expect(parseTakesResponse(good(2))).not.toBeNull()
    expect(parseTakesResponse(good(4))).not.toBeNull()
    expect(parseTakesResponse(good(2))).toHaveLength(2)
  })

  it('rejects fewer than 2 or more than 4', () => {
    expect(parseTakesResponse(good(1))).toBeNull()
    expect(parseTakesResponse(good(5))).toBeNull()
  })

  it('rejects a label over 24 chars', () => {
    const bad = good(2)
    bad.takes[0].label = 'a'.repeat(25)
    expect(parseTakesResponse(bad)).toBeNull()
  })

  it('rejects a malformed changes entry', () => {
    const bad: any = good(2)
    bad.takes[0].changes = [{ key: 'depth' }] // missing value
    expect(parseTakesResponse(bad)).toBeNull()
  })

  it('rejects non-object / missing takes', () => {
    expect(parseTakesResponse(null)).toBeNull()
    expect(parseTakesResponse({})).toBeNull()
    expect(parseTakesResponse({ takes: 'nope' })).toBeNull()
  })

  it('does NOT clamp values — that stays validatePatch\'s job client-side', () => {
    const takes = good(2)
    takes.takes[0].changes[0].value = 99 // out of the 0..1 slider range
    expect(parseTakesResponse(takes)![0].changes[0].value).toBe(99)
  })
})
