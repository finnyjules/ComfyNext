import { describe, it, expect } from 'vitest'
import { describeCanvas, verifyCanvas, buildCanvasQuestionPrompt, parseCanvasAnswer, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'

function graph(): CanvasSnapshot {
  return {
    nodes: [
      { id: '1', nodeType: 'CheckpointLoaderSimple', title: 'Load Checkpoint', widgets: { ckpt_name: 'sd_xl.safetensors' }, inputs: [], outputs: [{ name: 'MODEL', type: 'MODEL' }, { name: 'CLIP', type: 'CLIP' }] },
      { id: '2', nodeType: 'KSampler', title: 'KSampler', widgets: { seed: 42, steps: 20 }, inputs: [{ name: 'model', type: 'MODEL' }, { name: 'latent_image', type: 'LATENT' }], outputs: [{ name: 'LATENT', type: 'LATENT' }] },
      { id: '3', nodeType: 'SaveImage', title: 'Save Image', widgets: {}, inputs: [{ name: 'images', type: 'IMAGE' }], outputs: [] },
    ],
    edges: [
      { source: '1', sourcePort: 'MODEL', target: '2', targetPort: 'model' },
    ],
  }
}

describe('describeCanvas', () => {
  it('emits one object per node + a graph summary', () => {
    const snap = describeCanvas(graph())
    expect(snap.surface).toBe('canvas')
    expect(snap.objects.filter(o => o.type === 'node')).toHaveLength(3)
    const g = snap.objects.find(o => o.type === 'graph')!
    expect((g.current as { nodeCount: number; edgeCount: number }).nodeCount).toBe(3)
    expect((g.current as { edgeCount: number }).edgeCount).toBe(1)
  })
  it('marks which inputs are connected', () => {
    const snap = describeCanvas(graph())
    const ksampler = snap.objects.find(o => o.id === '2')!
    const inputs = (ksampler.current as { inputs: { name: string; connected: boolean }[] }).inputs
    expect(inputs.find(i => i.name === 'model')?.connected).toBe(true)
    expect(inputs.find(i => i.name === 'latent_image')?.connected).toBe(false)
  })
  it('renders connections as readable from → to strings', () => {
    const g = describeCanvas(graph()).objects.find(o => o.type === 'graph')!
    expect((g.current as { connections: string[] }).connections[0]).toContain('→')
  })
})

describe('verifyCanvas', () => {
  it('flags a required input with nothing connected', () => {
    const issues = verifyCanvas(graph())
    expect(issues.some(i => /latent_image/.test(i.message))).toBe(true) // KSampler.latent_image unconnected
    expect(issues.some(i => /images/.test(i.message))).toBe(true) // SaveImage.images unconnected
  })
  it('flags an isolated node', () => {
    const g = graph()
    g.nodes.push({ id: '9', nodeType: 'Note', title: 'Note', widgets: {}, inputs: [], outputs: [] })
    expect(verifyCanvas(g).some(i => i.target === '9' && /not connected/.test(i.message))).toBe(true)
  })
  it('skips required-input checks on muted/bypassed nodes', () => {
    const g = graph()
    g.nodes[2]!.mode = 2 // mute SaveImage
    expect(verifyCanvas(g).some(i => /images/.test(i.message))).toBe(false)
  })
  it('a fully-wired graph is clean', () => {
    const g: CanvasSnapshot = {
      nodes: [
        { id: '1', nodeType: 'A', title: 'A', widgets: {}, inputs: [], outputs: [{ name: 'out', type: 'IMAGE' }] },
        { id: '2', nodeType: 'B', title: 'B', widgets: {}, inputs: [{ name: 'in', type: 'IMAGE' }], outputs: [] },
      ],
      edges: [{ source: '1', sourcePort: 'out', target: '2', targetPort: 'in' }],
    }
    expect(verifyCanvas(g)).toEqual([])
  })
})

describe('buildCanvasQuestionPrompt', () => {
  it('includes the node names, the question, and the detected issues', () => {
    const p = buildCanvasQuestionPrompt(graph(), 'what does this graph do?')
    expect(p).toContain('KSampler')
    expect(p).toContain('what does this graph do?')
    expect(p).toContain('latent_image') // health issue surfaced into the prompt
  })
  it('handles an empty canvas', () => {
    expect(buildCanvasQuestionPrompt({ nodes: [], edges: [] }, 'hi')).toContain('(empty canvas)')
  })
})

describe('parseCanvasAnswer', () => {
  it('parses a plain JSON reply', () => {
    expect(parseCanvasAnswer('{"reasoning":"r","answer":"It loads a model then samples."}')).toEqual({ reasoning: 'r', answer: 'It loads a model then samples.' })
  })
  it('parses a fenced reply and tolerates junk', () => {
    expect(parseCanvasAnswer('```json\n{"reasoning":"x","answer":"y"}\n```').answer).toBe('y')
    expect(parseCanvasAnswer('not json')).toEqual({ reasoning: '', answer: '' })
  })
})
