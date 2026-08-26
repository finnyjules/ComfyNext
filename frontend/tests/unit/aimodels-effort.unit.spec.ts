/**
 * output_config.effort latency cap — server/lib/aiModels.ts.
 *
 * Sonnet 5 / Opus 5 run ADAPTIVE thinking whenever `thinking` is omitted, which
 * can spend real seconds reasoning before a schema-constrained routing answer.
 * effortForTier caps that per tier; this asserts (a) the actual request body a
 * plan-tier call sends carries output_config.effort 'low', not just that the
 * helper returns the right string, and (b) no Haiku-hardcoded route picks up
 * `effort` by copy-paste — Anthropic REJECTS output_config.effort on
 * claude-haiku-4-5 with a 400.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_TIERS, effortForTier, modelForTier } from '../../server/lib/aiModels'
import { buildAgentPlanRequestBody } from '../../server/api/agent-plan.post'

function src(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relPath}`, import.meta.url)), 'utf8')
}

describe('effortForTier', () => {
  it('plan (Sonnet 5) caps effort to low', () => {
    expect(effortForTier('plan')).toBe('low')
  })

  it('campaign (Opus 5) stays at high', () => {
    expect(effortForTier('campaign')).toBe('high')
  })

  it('patch (Haiku 4.5) has NO effort — the field errors on that model', () => {
    expect(effortForTier('patch')).toBeUndefined()
  })

  it('an unrecognised tier falls back to the same tier modelForTier resolves to (plan)', () => {
    expect(effortForTier('bogus')).toBe(effortForTier('plan'))
    expect(modelForTier('bogus')).toBe(modelForTier('plan'))
  })
})

describe('buildAgentPlanRequestBody (server/api/agent-plan.post.ts)', () => {
  it('a plan-tier call carries output_config.effort "low" in the actual request body', () => {
    const body = buildAgentPlanRequestBody('plan', 'do the thing', { type: 'object' })
    expect(body.model).toBe(AI_TIERS.plan)
    expect(body.output_config.effort).toBe('low')
    // format must survive the merge — effort is additive, not a replacement.
    expect(body.output_config.format).toEqual({ type: 'json_schema', schema: { type: 'object' } })
  })

  it('an undefined tier (server default → plan) still gets effort low', () => {
    const body = buildAgentPlanRequestBody(undefined, 'x', {})
    expect(body.output_config.effort).toBe('low')
  })
})

describe('Haiku-hardcoded routes never gain output_config.effort', () => {
  // claude-haiku-4-5 has no thinking/effort support; output_config.effort 400s
  // on it. These routes hardcode the model string directly (they don't go
  // through modelForTier), so a future copy-paste of the plan/campaign effort
  // pattern into one of them would silently break in production.
  //
  // `vibe-review` has its own builder pin (vibe-review.unit.spec.ts asserts the
  // assembled body carries no "effort"), but that only covers what the builder
  // returns. The scan here is what catches an `effort` added at HANDLER level —
  // spread into the fetch body after the builder, or slipped into a second call
  // site — which is exactly the copy-paste this guard exists for.
  const HAIKU_ROUTES = [
    'server/api/vibe.post.ts',
    'server/api/vibe-review.post.ts',
    'server/api/copy-assist.post.ts',
    'server/api/pipeline-suggest.post.ts',
  ]

  it.each(HAIKU_ROUTES)('%s hardcodes claude-haiku-4-5 and contains no "effort"', (relPath) => {
    const text = src(relPath)
    expect(text).toContain('claude-haiku-4-5')
    expect(text).not.toMatch(/effort/i)
  })
})
