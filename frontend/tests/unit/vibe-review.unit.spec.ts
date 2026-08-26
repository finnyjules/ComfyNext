// The see-first loop's contract half: the schema the model answers in, the
// prompt that asks it to LOOK, and the salvage that makes a bad review harmless.
//
// The governing rule here is narrower than "be tolerant": a review can only ever
// make a take BETTER or leave it alone. Anything malformed reads as `keep`, so
// the worst a broken review can do is nothing — which is exactly today's
// behaviour, and today's behaviour is the floor this feature must never fall
// below.
import { describe, it, expect } from 'vitest'
import {
  TAKE_REVIEW_SCHEMA,
  buildTakeReviewPrompt,
  parseTakeReview,
} from '~/lib/vibeReview'
import { buildTakeReviewRequestBody } from '../../server/api/vibe-review.post'

const CONTROLS = [
  { path: 'hue', label: 'Hue', kind: 'slider' as const, min: 0, max: 360, step: 1, current: 10 },
  { path: 'mood', label: 'Mood', kind: 'select' as const, options: ['calm', 'loud'], current: 'calm' },
]
const TAKES = [
  { label: 'warmer', changes: [{ key: 'hue', value: 40 }] },
  { label: 'louder', changes: [{ key: 'mood', value: 'loud' }] },
]

describe('TAKE_REVIEW_SCHEMA', () => {
  const item = (TAKE_REVIEW_SCHEMA as any).properties.reviews.items

  it('asks for a verdict per take, from a closed set', () => {
    expect(item.properties.verdict.enum).toEqual(['keep', 'fix', 'replace'])
    expect(item.required).toContain('verdict')
  })

  it('lets a fix or a replacement carry changes, a label and a reason', () => {
    expect(Object.keys(item.properties).sort()).toEqual(['changes', 'label', 'reason', 'verdict'])
    expect(item.properties.changes.items.properties.key.type).toBe('string')
  })

  it('is strict everywhere — structured outputs refuses an open object', () => {
    const opens: string[] = []
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
      if (!node || typeof node !== 'object') return
      const o = node as Record<string, unknown>
      if (o.type === 'object' && o.additionalProperties !== false) opens.push(path)
      for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`)
    }
    walk(TAKE_REVIEW_SCHEMA, 'TAKE_REVIEW_SCHEMA')
    expect(opens).toEqual([])
  })

  it('carries no keyword structured outputs rejects', () => {
    const banned = ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'allOf', '$ref']
    const found: string[] = []
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`))
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (banned.includes(k)) found.push(`${path}.${k}`)
        walk(v, `${path}.${k}`)
      }
    }
    walk(TAKE_REVIEW_SCHEMA, 'TAKE_REVIEW_SCHEMA')
    expect(found).toEqual([])
  })
})

describe('buildTakeReviewPrompt', () => {
  const prompt = buildTakeReviewPrompt('a dreamy sunset', CONTROLS as any, TAKES)

  it('states the ask and names every take in order', () => {
    expect(prompt).toContain('a dreamy sunset')
    expect(prompt.indexOf('warmer')).toBeLessThan(prompt.indexOf('louder'))
  })

  it('asks the question as a PICTURE, not as a config', () => {
    expect(prompt.toLowerCase()).toMatch(/look|see|picture|image/)
    expect(prompt.toLowerCase()).toMatch(/would (a )?person|does it read|looking at/)
  })

  it('offers the vocabulary a fix may draw from, and forbids inventing keys', () => {
    expect(prompt).toContain('hue')
    expect(prompt).toContain('mood')
    expect(prompt.toLowerCase()).toMatch(/only|do not invent|from the list/)
  })

  it('says which image is the user’s current design', () => {
    expect(prompt.toLowerCase()).toContain('yours')
  })

  it('is terse — a paragraph and a list, not an essay', () => {
    expect(prompt.length).toBeLessThan(1800)
  })
})

describe('parseTakeReview — a bad review can only ever do nothing', () => {
  const verdicts = (raw: unknown, n = 2) => parseTakeReview(raw, n).map(r => r.verdict)

  it('reads a well-formed review', () => {
    const out = parseTakeReview({ reviews: [
      { verdict: 'keep' },
      { verdict: 'fix', changes: [{ key: 'hue', value: 300 }], label: 'cooler', reason: 'too warm' },
    ] }, 2)
    expect(out[0]).toEqual({ verdict: 'keep' })
    expect(out[1]).toMatchObject({ verdict: 'fix', label: 'cooler', reason: 'too warm' })
    expect(out[1]!.changes).toEqual([{ key: 'hue', value: 300 }])
  })

  it('always returns exactly one verdict per take', () => {
    expect(parseTakeReview({ reviews: [{ verdict: 'fix' }] }, 4)).toHaveLength(4)
    expect(parseTakeReview({ reviews: Array(9).fill({ verdict: 'replace' }) }, 2)).toHaveLength(2)
  })

  it('treats anything malformed as keep', () => {
    for (const bad of [null, undefined, 42, 'keep', { reviews: 'nope' }, { reviews: [7, null] }, {}]) {
      expect(verdicts(bad)).toEqual(['keep', 'keep'])
    }
  })

  it('an unknown verdict word is keep', () => {
    expect(verdicts({ reviews: [{ verdict: 'delete' }, { verdict: 'FIX' }] })).toEqual(['keep', 'keep'])
  })

  it('a fix with no usable changes degrades to keep — there is nothing to apply', () => {
    expect(verdicts({ reviews: [{ verdict: 'fix' }, { verdict: 'fix', changes: [] }] })).toEqual(['keep', 'keep'])
  })

  it('a replace with no usable changes degrades to keep too', () => {
    expect(verdicts({ reviews: [{ verdict: 'replace', label: 'x' }, { verdict: 'replace', changes: 'no' }] }))
      .toEqual(['keep', 'keep'])
  })

  it('drops a malformed change entry without losing the verdict', () => {
    const out = parseTakeReview({ reviews: [
      { verdict: 'fix', changes: [{ key: 'hue', value: 300 }, { key: 7, value: 1 }, { nope: true }] },
    ] }, 1)
    expect(out[0]).toMatchObject({ verdict: 'fix' })
    expect(out[0]!.changes).toEqual([{ key: 'hue', value: 300 }])
  })

  it('ignores a label or reason that is not text', () => {
    const out = parseTakeReview({ reviews: [
      { verdict: 'fix', changes: [{ key: 'hue', value: 1 }], label: 42, reason: { a: 1 } },
    ] }, 1)
    expect(out[0]!.label).toBeUndefined()
    expect(out[0]!.reason).toBeUndefined()
  })
})


describe('buildTakeReviewRequestBody', () => {
  const body: any = buildTakeReviewRequestBody('prompt text', [
    'data:image/jpeg;base64,YOURS', 'data:image/jpeg;base64,ONE', 'data:image/jpeg;base64,TWO',
  ])

  it('is Haiku, with the review schema and no effort knob', () => {
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.output_config.format.schema).toBe(TAKE_REVIEW_SCHEMA)
    // Haiku ERRORS on output_config.effort — the same trap vibe.post.ts is
    // scanned for. This must never grow one by copy-paste.
    expect(JSON.stringify(body)).not.toContain('effort')
  })

  it('sends the images BEFORE the instruction that refers to them', () => {
    const content = body.messages[0].content
    expect(content.slice(0, 3).map((c: any) => c.type)).toEqual(['image', 'image', 'image'])
    expect(content[3].type).toBe('text')
  })

  it('sends "yours" first, then the takes in order', () => {
    const data = body.messages[0].content.filter((c: any) => c.type === 'image').map((c: any) => c.source.data)
    expect(data).toEqual(['YOURS', 'ONE', 'TWO'])
  })

  it('splits the media type out of the data URL', () => {
    expect(body.messages[0].content[0].source.media_type).toBe('image/jpeg')
    const bare: any = buildTakeReviewRequestBody('p', ['RAWBASE64'])
    expect(bare.messages[0].content[0].source).toMatchObject({ media_type: 'image/jpeg', data: 'RAWBASE64' })
  })
})

describe('the route is metered and rate-limited like its siblings', () => {
  it('calls meterAssist and assertRateLimit', async () => {
    // The coverage guard in anthropic-meter.unit.spec.ts discovers this file by
    // its fetch target; this states the same requirement where a reader of the
    // feature will see it.
    const fs = await import('node:fs')
    const src = fs.readFileSync(`${process.cwd()}/server/api/vibe-review.post.ts`, 'utf8')
    expect(src).toMatch(/meterAssist\(event\)/)
    expect(src).toMatch(/assertRateLimit\(event/)
  })
})
