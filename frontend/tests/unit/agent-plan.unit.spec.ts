import { describe, it, expect } from 'vitest'
import type { TemplateV3 } from '~~/shared/template-grid/types'
import { applySmartLayoutCommand, describeSmartLayout } from '~/lib/agent/surfaces/smartLayout'
import { applyPlan } from '~/lib/agent/plan'
import { buildAgentPrompt, buildCommandSchema, buildResultReviewPrompt, buildReviewPrompt, buildReviewSchema, parseAgentResponse, parseReviewResponse, RESULT_REVIEW_SYSTEM } from '~/lib/agent/protocol'

function fx(): TemplateV3 {
  return {
    version: 3, id: 't', name: 'T', master: 'sq',
    formats: { sq: { w: 1080, h: 1080 } },
    grid: { gutter: 24, margin: 48, baseline: 12 },
    typeScale: { base: 16, ratio: 1.25 },
    elements: [],
    sections: [{
      id: 'section-1', name: 'Hero', region: { col: 1, colSpan: 6, row: 1, rowSpan: 3 },
      children: [{ id: 'h', type: 'text', content: 'OLD', level: 'headline', priority: 1, region: { col: 1, colSpan: 4, row: 1, rowSpan: 1 } }],
    }],
  }
}

function contentOf(t: TemplateV3, id: string): unknown {
  const el = t.elements.find(e => e.id === id) ?? t.sections.flatMap(s => s.children).find(e => e.id === id)
  return el && 'content' in el ? (el as { content: unknown }).content : undefined
}

describe('applyPlan', () => {
  const plan = [
    { op: 'setText', target: 'h', args: { text: 'NEW' } },
    { op: 'setSectionRegion', target: 'section-1', args: { region: { col: 2, colSpan: 4, row: 2, rowSpan: 2 } } },
  ]

  it('applies a multi-command plan in sequence', () => {
    const r = applyPlan(fx(), plan, applySmartLayoutCommand)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(contentOf(r.template, 'h')).toBe('NEW')
    expect(r.template.sections[0]!.region).toEqual({ col: 2, colSpan: 4, row: 2, rowSpan: 2 })
  })

  it('the batched inverse undoes the whole plan', () => {
    const before = fx()
    const r = applyPlan(before, plan, applySmartLayoutCommand)
    if (!r.ok) throw new Error('plan failed')
    const undo = applyPlan(r.template, r.inverse, applySmartLayoutCommand)
    if (!undo.ok) throw new Error('undo failed')
    expect(undo.template).toEqual(before)
  })

  it('stops at the first failing command and rolls back the partial', () => {
    const bad = [
      { op: 'setText', target: 'h', args: { text: 'NEW' } },
      { op: 'frobnicate' },
    ]
    const r = applyPlan(fx(), bad, applySmartLayoutCommand)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failedAt).toBe(1)
    const rolledBack = applyPlan(r.template, r.inverse, applySmartLayoutCommand)
    if (!rolledBack.ok) throw new Error('rollback failed')
    expect(contentOf(rolledBack.template, 'h')).toBe('OLD')
  })

  it('an empty plan is a no-op', () => {
    const before = fx()
    const r = applyPlan(before, [], applySmartLayoutCommand)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.template).toEqual(before)
    expect(r.inverse).toEqual([])
  })
})

describe('protocol', () => {
  it('buildCommandSchema constrains op to the surface catalog', () => {
    const schema = buildCommandSchema(describeSmartLayout(fx()).commands) as {
      properties: { commands: { items: { properties: { op: { enum: string[] } } } } }
    }
    const ops = schema.properties.commands.items.properties.op.enum
    expect(ops).toEqual(expect.arrayContaining(['setText', 'group', 'setSectionRegion']))
  })

  it('buildAgentPrompt includes the user phrase, an object id, and a command', () => {
    const prompt = buildAgentPrompt(describeSmartLayout(fx()), 'change the headline')
    expect(prompt).toContain('change the headline')
    expect(prompt).toContain('section-1')
    expect(prompt).toContain('setText')
  })

  it('parses a model response with args as a JSON string', () => {
    const text = JSON.stringify({ rationale: 'x', commands: [{ op: 'setText', target: 'h', args: JSON.stringify({ text: 'HELLO' }) }] })
    const { commands, rationale } = parseAgentResponse(text)
    expect(rationale).toBe('x')
    expect(commands[0]).toEqual({ op: 'setText', target: 'h', args: { text: 'HELLO' } })
  })

  it('carries a per-change rationale parallel to the commands', () => {
    const text = JSON.stringify({ rationale: 'x', commands: [
      { op: 'setText', target: 'h', args: JSON.stringify({ text: 'HELLO' }), rationale: 'punchier hook' },
      { op: 'setSectionRegion', target: 'section-1', args: JSON.stringify({ region: { col: 1, colSpan: 6, row: 1, rowSpan: 1 } }) },
    ] })
    const { changeRationales } = parseAgentResponse(text)
    expect(changeRationales[0]).toBe('punchier hook')
    expect(changeRationales[1]).toBe('') // missing rationale → empty string, never undefined
  })

  it('command schema includes a per-change rationale field', () => {
    const schema = buildCommandSchema(describeSmartLayout(fx()).commands) as {
      properties: { commands: { items: { properties: Record<string, unknown> } } }
    }
    expect(schema.properties.commands.items.properties.rationale).toBeDefined()
  })

  it('command schema has a required top-level message channel (answer / refuse / clarify)', () => {
    const schema = buildCommandSchema(describeSmartLayout(fx()).commands) as {
      properties: Record<string, unknown>; required: string[]
    }
    expect(schema.properties.message).toBeDefined()
    expect(schema.required).toContain('message')
  })

  it('extracts the JSON plan even when wrapped in a ```json fence or prose (streamed thinking has no strict schema)', () => {
    const fenced = 'Here is the plan:\n```json\n' + JSON.stringify({ rationale: 'x', commands: [{ op: 'setText', target: 'h', args: '{"text":"HI"}' }] }) + '\n```'
    const { commands } = parseAgentResponse(fenced)
    expect(commands[0]).toEqual({ op: 'setText', target: 'h', args: { text: 'HI' } })
    const prose = 'Sure! ' + JSON.stringify({ rationale: 'y', commands: [], message: 'done' }) + ' hope that helps'
    expect(parseAgentResponse(prose).message).toBe('done')
  })

  it('parses the message channel; empty when absent', () => {
    const withMsg = parseAgentResponse(JSON.stringify({ rationale: '', commands: [], message: 'I can change text, colours and layout — not generate audio.' }))
    expect(withMsg.message).toContain('I can change')
    expect(withMsg.commands).toEqual([])
    const noMsg = parseAgentResponse(JSON.stringify({ rationale: 'x', commands: [] }))
    expect(noMsg.message).toBe('')
  })

  it('parses the reasoning field (the model\'s thinking, shown to the user)', () => {
    const r = parseAgentResponse(JSON.stringify({ reasoning: 'They want a blue canvas, so I will set the background fill.', rationale: 'x', commands: [], message: '' }))
    expect(r.reasoning).toContain('blue canvas')
    expect(parseAgentResponse('{}').reasoning).toBe('')
  })

  it('command schema requires the reasoning field', () => {
    const schema = buildCommandSchema(describeSmartLayout(fx()).commands) as { properties: Record<string, unknown>; required: string[] }
    expect(schema.properties.reasoning).toBeDefined()
    expect(schema.required).toContain('reasoning')
  })

  it('the prompt instructs an honest refusal / answer instead of forcing a command', () => {
    const prompt = buildAgentPrompt(describeSmartLayout(fx()), 'order me a pizza')
    expect(prompt.toLowerCase()).toContain('outside the command list')
    expect(prompt).toContain('generateImage') // generative content is now in-vocabulary
  })

  it('builds a visual-review schema (assessment + issues + fixes) and prompt', () => {
    const snap = describeSmartLayout(fx())
    const schema = buildReviewSchema(snap.commands) as { properties: Record<string, unknown>; required: string[] }
    expect(schema.properties.assessment).toBeDefined()
    expect(schema.properties.issues).toBeDefined()
    expect(schema.properties.fixes).toBeDefined()
    expect(schema.required).toEqual(expect.arrayContaining(['assessment', 'issues', 'fixes']))
    const prompt = buildReviewPrompt(snap, 'make a poster')
    expect(prompt.toLowerCase()).toContain('attached image')
    expect(prompt).toContain('make a poster')
  })

  it('result-review prompt judges achievement of the request, NOT Swiss design', () => {
    const snap = describeSmartLayout(fx()) // any surface; we only assert the prompt framing
    // The prompt is split for caching: static instruction (system) + dynamic half.
    const prompt = buildResultReviewPrompt(snap, 'a dog in GTA style')
    expect(RESULT_REVIEW_SYSTEM.toLowerCase()).toContain('attached image')
    expect(RESULT_REVIEW_SYSTEM).toContain('ACHIEVES THE REQUEST')
    expect(RESULT_REVIEW_SYSTEM).not.toContain('SWISS') // must not impose a style the user didn't ask for
    expect(prompt).toContain('a dog in GTA style')
    expect(prompt).not.toContain('SWISS')
  })

  it('parses a visual-review reply into assessment, issues and fix commands', () => {
    const text = JSON.stringify({
      assessment: 'Strong, but the headline crowds the edge.',
      issues: ['headline touches the right edge', 'subhead too close to headline'],
      fixes: [{ op: 'setElementProps', target: 'h', args: JSON.stringify({ patch: { region: { col: 1, colSpan: 40, row: 1, rowSpan: 6 } } }), rationale: 'give the headline room' }],
    })
    const r = parseReviewResponse(text)
    expect(r.assessment).toContain('crowds')
    expect(r.issues).toHaveLength(2)
    expect(r.fixes[0]).toEqual({ op: 'setElementProps', target: 'h', args: { patch: { region: { col: 1, colSpan: 40, row: 1, rowSpan: 6 } } } })
  })

  it('carries the Swiss design system so the agent composes in that style by default', () => {
    const prompt = buildAgentPrompt(describeSmartLayout(fx()), 'make a poster')
    expect(prompt).toContain('SWISS')
    expect(prompt.toLowerCase()).toContain('flush-left')
    expect(prompt.toLowerCase()).toContain('grid')
  })
})

describe('end-to-end (simulated model)', () => {
  it('a phrase-shaped plan applies and fully undoes', () => {
    const before = fx()
    // What the model would return for "change the headline to HELLO":
    const modelJson = JSON.stringify({
      rationale: 'set the headline copy',
      commands: [{ op: 'setText', target: 'h', args: JSON.stringify({ text: 'HELLO' }) }],
    })
    const { commands } = parseAgentResponse(modelJson)
    const r = applyPlan(before, commands, applySmartLayoutCommand)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(contentOf(r.template, 'h')).toBe('HELLO')
    const undo = applyPlan(r.template, r.inverse, applySmartLayoutCommand)
    if (!undo.ok) throw new Error('undo failed')
    expect(contentOf(undo.template, 'h')).toBe('OLD')
  })
})
