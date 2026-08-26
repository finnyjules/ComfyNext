// The eye-pick: the model chooses four of OUR rendered candidates by looking at
// them. It returns indices, so it cannot invent a take — and an index we did not
// offer is dropped rather than remapped to something nearby, which would be us
// making a choice and attributing it to the model.
import { describe, it, expect } from 'vitest'
import { EYE_PICK_SCHEMA, buildEyePickPrompt, fillPicks, salvageEyePicks } from '~/lib/gradientfx/eyePick'
import { buildEyePickRequestBody } from '../../server/api/vibe-pick.post'

const wrap = (...picks: unknown[]) => ({ picks })

describe('EYE_PICK_SCHEMA', () => {
  it('asks for an index, and optionally a name and a reason', () => {
    const item = (EYE_PICK_SCHEMA as any).properties.picks.items
    expect(item.required).toEqual(['index'])
    expect(Object.keys(item.properties).sort()).toEqual(['index', 'label', 'reason'])
    expect(item.additionalProperties).toBe(false)
  })

  it('carries no keyword structured outputs rejects', () => {
    const banned = ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'pattern', 'allOf', '$ref']
    const found: string[] = []
    const walk = (n: unknown, p: string) => {
      if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${p}[${i}]`))
      if (!n || typeof n !== 'object') return
      for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
        if (banned.includes(k)) found.push(`${p}.${k}`)
        walk(v, `${p}.${k}`)
      }
    }
    walk(EYE_PICK_SCHEMA, 'EYE_PICK_SCHEMA')
    expect(found).toEqual([])
  })
})

describe('buildEyePickPrompt', () => {
  const p = buildEyePickPrompt('a dreamy sunset', ['dusk', 'ember', 'cool dusk'])

  it('numbers the candidates from one, in order', () => {
    expect(p).toContain('1. dusk')
    expect(p).toContain('3. cool dusk')
  })

  it('says the first image is the user’s and must not be picked', () => {
    expect(p.toLowerCase()).toMatch(/current design/)
    expect(p.toLowerCase()).toMatch(/do not pick it/)
  })

  it('asks for four, different from each other AND from what they have', () => {
    expect(p).toMatch(/FOUR/)
    expect(p.toLowerCase()).toContain('different from each other')
    expect(p.toLowerCase()).toContain('already have')
  })
})

describe('buildEyePickRequestBody', () => {
  const body: any = buildEyePickRequestBody('p', ['data:image/jpeg;base64,YOURS', 'data:image/jpeg;base64,ONE'])

  it('is Haiku with the pick schema and no latency knob', () => {
    expect(body.model).toBe('claude-haiku-4-5')
    expect(body.output_config.format.schema).toBe(EYE_PICK_SCHEMA)
    expect(JSON.stringify(body)).not.toContain('effort')
  })

  it('sends "yours" first, then the candidates, then the instruction', () => {
    const c = body.messages[0].content
    expect(c.map((x: any) => x.type)).toEqual(['image', 'image', 'text'])
    expect(c[0].source.data).toBe('YOURS')
  })
})

describe('salvageEyePicks', () => {
  it('reads well-formed picks, converting from the prompt’s 1-based numbers', () => {
    const out = salvageEyePicks(wrap({ index: 1, label: 'dusk', reason: 'warm' }, { index: 3 }), 5)
    expect(out).toEqual([{ index: 0, label: 'dusk', reason: 'warm' }, { index: 2 }])
  })

  it('drops an index we never offered rather than remapping it', () => {
    // Remapping would be us choosing, then calling it the model's choice.
    expect(salvageEyePicks(wrap({ index: 0 }, { index: 99 }, { index: -2 }), 4)).toEqual([])
  })

  it('drops repeats — four slots, four different candidates', () => {
    expect(salvageEyePicks(wrap({ index: 2 }, { index: 2 }, { index: 1 }), 4).map(p => p.index)).toEqual([1, 0])
  })

  it('never returns more than we asked for', () => {
    expect(salvageEyePicks(wrap(...[1, 2, 3, 4, 5, 6].map(index => ({ index }))), 8)).toHaveLength(4)
  })

  it('anything unreadable is an empty list, never a throw', () => {
    for (const bad of [null, undefined, 5, 'picks', {}, { picks: 'no' }, { picks: [null, 'x', { index: 'two' }] }]) {
      expect(salvageEyePicks(bad, 4)).toEqual([])
    }
  })
})

describe('fillPicks — our code fills what the model could not', () => {
  /** A line of candidates 10 apart: 0 at 0, 1 at 10, 2 at 20… */
  const spaced = (a: number, b: number) => Math.abs(a - b) * 10

  it('leaves a full set alone', () => {
    const picked = [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]
    expect(fillPicks(picked, 8, spaced)).toEqual(picked)
  })

  it('fills the remaining slots with the FARTHEST candidates from what is chosen', () => {
    const out = fillPicks([{ index: 0 }], 5, spaced)
    expect(out.map(p => p.index)).toEqual([0, 4, 2, 1])
  })

  it('is deterministic — same inputs, same fill, every time', () => {
    const a = fillPicks([{ index: 1 }], 6, spaced).map(p => p.index)
    const b = fillPicks([{ index: 1 }], 6, spaced).map(p => p.index)
    expect(a).toEqual(b)
  })

  it('keeps the model’s picks first, and adds no name it did not give', () => {
    const out = fillPicks([{ index: 3, label: 'theirs' }], 5, spaced)
    expect(out[0]).toEqual({ index: 3, label: 'theirs' })
    for (const p of out.slice(1)) expect(p.label).toBeUndefined()
  })

  it('cannot return more picks than there are candidates', () => {
    expect(fillPicks([], 2, spaced)).toHaveLength(2)
  })

  it('treats an unmeasurable pair as far apart, never as a reason to reject', () => {
    // Same posture as the checkers: no evidence is not evidence against.
    const out = fillPicks([{ index: 0 }], 3, () => null)
    expect(out).toHaveLength(3)
  })
})
