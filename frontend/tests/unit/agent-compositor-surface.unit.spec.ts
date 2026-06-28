import { describe, it, expect } from 'vitest'
import type { LocalLayer } from '~/composables/useCompositorLayers'
import { describeCompositor, applyCompositorCommand, summarizeCompositorChange, verifyCompositor, type CompositorState } from '~/lib/agent/surfaces/compositor'

function state(): CompositorState {
  return {
    layers: [
      { id: 't1', kind: 'text', x: 0.5, y: 0.3, rotation: 0, opacity: 1, text: 'HELLO', fontFamily: 'Inter', fontWeight: 700, fontSize: 0.1, color: '#ffffff', align: 'center', lineHeight: 1.1, strokeColor: '', strokeWidth: 0 },
      { id: 'r1', kind: 'rect', x: 0.5, y: 0.7, rotation: 0, opacity: 1, w: 0.4, h: 0.2, fill: '#ff0000', stroke: '', strokeWidth: 0, radius: 0 },
      { id: 'img1', kind: 'image', x: 0.5, y: 0.5, rotation: 0, opacity: 1, filename: 'pic.png', w: 0.5, h: 0.5 },
    ] as LocalLayer[],
    background: '#000000',
  }
}

describe('describeCompositor', () => {
  it('lists each layer + a document object with the background', () => {
    const snap = describeCompositor(state())
    expect(snap.surface).toBe('compositor')
    expect(snap.objects.find(o => o.id === 't1')?.current).toMatchObject({ text: 'HELLO', color: '#ffffff' })
    const doc = snap.objects.find(o => o.type === 'document')!
    expect((doc.current as { background: string }).background).toBe('#000000')
  })
  it('every command carries a hint', () => {
    const snap = describeCompositor(state())
    expect(snap.commands.length).toBeGreaterThan(8)
    expect(snap.commands.every(c => typeof c.hint === 'string' && c.hint!.length > 0)).toBe(true)
  })
})

describe('applyCompositorCommand', () => {
  it('setLayerProps moves a layer and is invertible', () => {
    const before = state()
    const r = applyCompositorCommand(before, { op: 'setLayerProps', target: 't1', args: { patch: { x: 0.2, y: 0.1 } } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.layers[0]).toMatchObject({ x: 0.2, y: 0.1 })
    const undo = applyCompositorCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.layers).toEqual(before.layers)
  })
  it('setLayerProps rejects an unknown prop', () => {
    expect(applyCompositorCommand(state(), { op: 'setLayerProps', target: 't1', args: { patch: { fill: '#fff' } } }).ok).toBe(false)
  })
  it('setText changes copy; rejects a non-text layer', () => {
    const r = applyCompositorCommand(state(), { op: 'setText', target: 't1', args: { text: 'WORLD' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect((r.template.layers[0] as { text: string }).text).toBe('WORLD')
    expect(applyCompositorCommand(state(), { op: 'setText', target: 'r1', args: { text: 'x' } }).ok).toBe(false)
  })
  it('setFill sets text colour, shape fill, and accepts a gradient', () => {
    expect((applyCompositorCommand(state(), { op: 'setFill', target: 't1', args: { paint: '#00ff00' } }) as any).template.layers[0].color).toBe('#00ff00')
    expect((applyCompositorCommand(state(), { op: 'setFill', target: 'r1', args: { paint: '#0000ff' } }) as any).template.layers[1].fill).toBe('#0000ff')
    const grad = { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#f0f' }, { offset: 1, color: '#0ff' }] }
    const r = applyCompositorCommand(state(), { op: 'setFill', target: 'r1', args: { paint: grad } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect((r.template.layers[1] as any).fill).toEqual(grad)
  })
  it('setStroke sets stroke + width on a shape', () => {
    const r = applyCompositorCommand(state(), { op: 'setStroke', target: 'r1', args: { paint: '#fff', width: 0.01 } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect((r.template.layers[1] as any).stroke).toBe('#fff')
    expect((r.template.layers[1] as any).strokeWidth).toBe(0.01)
  })
  it('setSize resizes a rect; rejects a dimension the kind lacks', () => {
    expect((applyCompositorCommand(state(), { op: 'setSize', target: 'r1', args: { w: 0.6, h: 0.3 } }) as any).template.layers[1]).toMatchObject({ w: 0.6, h: 0.3 })
    expect(applyCompositorCommand(state(), { op: 'setSize', target: 't1', args: { w: 0.5 } }).ok).toBe(false) // text has no w
  })
  it('addLayer adds a text layer with defaults; rejects a bad kind', () => {
    const r = applyCompositorCommand(state(), { op: 'addLayer', args: { layer: { kind: 'text', x: 0.2, y: 0.2, text: 'Hi' } } })
    expect(r.ok).toBe(true); if (!r.ok) return
    const added = r.template.layers.at(-1) as any
    expect(added).toMatchObject({ kind: 'text', text: 'Hi', x: 0.2 })
    expect(added.fontFamily).toBeTruthy() // default filled in
    expect(applyCompositorCommand(state(), { op: 'addLayer', args: { layer: { kind: 'image' } } }).ok).toBe(false)
  })
  it('removeLayer deletes and inverts', () => {
    const before = state()
    const r = applyCompositorCommand(before, { op: 'removeLayer', target: 'r1' })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.template.layers.some(l => l.id === 'r1')).toBe(false)
    const undo = applyCompositorCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.layers).toEqual(before.layers)
  })
  it('setBackground sets a colour and clears on "none"', () => {
    expect((applyCompositorCommand(state(), { op: 'setBackground', args: { paint: '#123456' } }) as any).template.background).toBe('#123456')
    expect((applyCompositorCommand(state(), { op: 'setBackground', args: { paint: 'none' } }) as any).template.background).toBeUndefined()
  })
  it('rejects an out-of-vocabulary op', () => {
    expect(applyCompositorCommand(state(), { op: 'frobnicate' }).ok).toBe(false)
  })
  it('does not mutate the input', () => {
    const before = state()
    applyCompositorCommand(before, { op: 'setFill', target: 'r1', args: { paint: '#fff' } })
    expect((before.layers[1] as any).fill).toBe('#ff0000')
  })
})

describe('verifyCompositor', () => {
  it('flags an off-canvas layer', () => {
    const s = state(); (s.layers[1] as any).x = 1.4
    expect(verifyCompositor(s).some(i => /off-canvas/i.test(i.message))).toBe(true)
  })
  it('flags low-contrast text on the background', () => {
    const s = state(); (s.layers[0] as any).color = '#0a0a0a' // near-black text on #000000 bg
    expect(verifyCompositor(s).some(i => /contrast/i.test(i.message))).toBe(true)
  })
  it('flags very small text', () => {
    const s = state(); (s.layers[0] as any).fontSize = 0.01
    expect(verifyCompositor(s).some(i => /small/i.test(i.message))).toBe(true)
  })
  it('a legible, on-canvas frame is clean', () => {
    expect(verifyCompositor(state())).toEqual([]) // white text on black bg, in-frame
  })
})

describe('summarizeCompositorChange', () => {
  it('summarizes setFill with a before/after', () => {
    const s = summarizeCompositorChange(state(), { op: 'setFill', target: 'r1', args: { paint: '#0000ff' } })
    expect(s?.before).toBe('#ff0000')
    expect(s?.after).toBe('#0000ff')
  })
  it('renders a gradient paint as "gradient"', () => {
    const s = summarizeCompositorChange(state(), { op: 'setBackground', args: { paint: { type: 'linear', angle: 0, stops: [] } } })
    expect(s?.after).toBe('gradient')
  })
})
