import { describe, it, expect } from 'vitest'
import { sketchRequests } from '~/lib/agent/surfaces/canvas'

describe('sketchRequests', () => {
  it('extracts prompts from sketch commands only', () => {
    const cmds = [
      { op: 'sketch', args: { prompt: 'a lighthouse at dusk' } },
      { op: 'setWidget', target: 'n1', args: { name: 'seed', value: 5 } },
      { op: 'sketch', args: { prompt: 'a red door' } },
    ]
    expect(sketchRequests(cmds as any)).toEqual(['a lighthouse at dusk', 'a red door'])
  })
  it('ignores sketch commands without a prompt', () => {
    expect(sketchRequests([{ op: 'sketch', args: {} }] as any)).toEqual([])
  })
  it('returns empty when there are no sketch commands', () => {
    expect(sketchRequests([{ op: 'searchImages', args: { query: 'x' } }] as any)).toEqual([])
  })
})
