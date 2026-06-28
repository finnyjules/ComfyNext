import { describe, it, expect } from 'vitest'
import type { TemplateV3 } from '~~/shared/template-grid/types'
import { applySmartLayoutCommand, describeSmartLayout } from '~/lib/agent/surfaces/smartLayout'
import { applyPlan } from '~/lib/agent/plan'
import { buildAgentPrompt, buildCommandSchema, parseAgentResponse } from '~/lib/agent/protocol'

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
