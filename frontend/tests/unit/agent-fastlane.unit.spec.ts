import { describe, it, expect } from 'vitest'
import { isFastLanePlacement } from '~/lib/agent/fastlane'
import type { Command } from '~/lib/agent/commandSurface'

const addNode = (nodeType: string, extra: Partial<Command> = {}): Command =>
  ({ op: 'addNode', args: { nodeType, id: '$new1', widgetOverrides: { prompt: 'a red fox' } }, ...extra })

describe('isFastLanePlacement', () => {
  it('accepts a single generator addNode', () => {
    expect(isFastLanePlacement([addNode('GenerateImageNode')])).toBe(true)
  })
  it('accepts a single frontend-only studio addNode (gradient/texture exception)', () => {
    expect(isFastLanePlacement([addNode('GradientStudio')])).toBe(true)
    expect(isFastLanePlacement([addNode('TextureStudio')])).toBe(true)
  })
  it('rejects a single effect addNode (a lone unwired edit is a half-plan)', () => {
    expect(isFastLanePlacement([addNode('EditImageNode')])).toBe(false)
    expect(isFastLanePlacement([addNode('UpscaleImageNode')])).toBe(false)
  })
  it('rejects a multi-command plan (addNode + connect)', () => {
    expect(isFastLanePlacement([
      addNode('GenerateImageNode'),
      { op: 'connect', args: { from: '$new1', to: 'node-2' } },
    ])).toBe(false)
  })
  it('rejects a single non-addNode command', () => {
    expect(isFastLanePlacement([{ op: 'setWidget', target: 'node-1', args: { name: 'steps', value: 30 } }])).toBe(false)
    expect(isFastLanePlacement([{ op: 'tuneNode', target: 'node-1', args: { request: 'bluer' } }])).toBe(false)
  })
  it('rejects an addNode that targets an existing node', () => {
    expect(isFastLanePlacement([addNode('GenerateImageNode', { target: 'node-1' })])).toBe(false)
  })
  it('rejects an unknown / non-catalog nodeType', () => {
    expect(isFastLanePlacement([addNode('SomeRawProviderNode')])).toBe(false)
  })
  it('rejects an empty plan', () => {
    expect(isFastLanePlacement([])).toBe(false)
  })
  it('rejects addNode with a non-string nodeType', () => {
    expect(isFastLanePlacement([{ op: 'addNode', args: {} }])).toBe(false)
  })
})
