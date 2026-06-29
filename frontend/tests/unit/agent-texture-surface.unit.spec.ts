import { describe, it, expect } from 'vitest'
import { describeTexture, applyTextureCommand, summarizeTextureChange, verifyTexture, type TextureState } from '~/lib/agent/surfaces/texture'
import { textureDefaults } from '~/lib/texturefx/controls'

function state(): TextureState {
  // procedural / checker → roles ['a','b']
  const params = textureDefaults()
  params.mode = 'procedural'
  params.motif = 'checker'
  return { params }
}

describe('describeTexture', () => {
  it('lists each active role + a settings + document object', () => {
    const snap = describeTexture(state())
    expect(snap.surface).toBe('texture')
    expect(snap.objects.filter(o => o.type === 'role').map(o => o.id)).toEqual(['a', 'b'])
    expect(snap.objects.find(o => o.type === 'settings')).toBeTruthy()
    expect(snap.objects.find(o => o.type === 'document')).toBeTruthy()
  })
  it('every command carries a hint', () => {
    const snap = describeTexture(state())
    expect(snap.commands.length).toBeGreaterThan(6)
    expect(snap.commands.every(c => typeof c.hint === 'string' && c.hint!.length > 0)).toBe(true)
  })
})

describe('applyTextureCommand', () => {
  it('setFillColor paints a role solid and is invertible', () => {
    const before = state()
    const r = applyTextureCommand(before, { op: 'setFillColor', target: 'a', args: { color: '#ff0000' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect((r.template.params as any).fills.a).toEqual({ type: 'solid', color: '#ff0000' })
    const undo = applyTextureCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect((undo.template.params as any).fills ?? {}).toEqual((before.params as any).fills ?? {})
  })
  it('setFillColor rejects a non-role target and a bad colour', () => {
    expect(applyTextureCommand(state(), { op: 'setFillColor', target: 'zzz', args: { color: '#ff0000' } }).ok).toBe(false)
    expect(applyTextureCommand(state(), { op: 'setFillColor', target: 'a', args: { color: 'red' } }).ok).toBe(false)
  })
  it('setFillGradient builds a {c,p} gradient from {color,offset} stops', () => {
    const r = applyTextureCommand(state(), { op: 'setFillGradient', target: 'b', args: { stops: [{ color: '#ff99f7', offset: 0 }, { color: '#ff6259', offset: 1 }], angle: 45 } })
    expect(r.ok).toBe(true); if (!r.ok) return
    const f = (r.template.params as any).fills.b
    expect(f).toMatchObject({ type: 'gradient', kind: 'linear', angle: 45 })
    expect(f.stops).toEqual([{ c: '#ff99f7', p: 0 }, { c: '#ff6259', p: 1 }])
  })
  it('setFillGradient rejects fewer than two stops', () => {
    expect(applyTextureCommand(state(), { op: 'setFillGradient', target: 'a', args: { stops: [{ color: '#ffffff', offset: 0 }] } }).ok).toBe(false)
  })
  it('linkFill points a role at another; rejects self-link', () => {
    const r = applyTextureCommand(state(), { op: 'linkFill', target: 'a', args: { to: 'b' } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect((r.template.params as any).fills.a).toEqual({ type: 'link', to: 'b' })
    expect(applyTextureCommand(state(), { op: 'linkFill', target: 'a', args: { to: 'a' } }).ok).toBe(false)
  })
  it('clearFill removes a custom fill; rejects when none', () => {
    const withFill = applyTextureCommand(state(), { op: 'setFillColor', target: 'a', args: { color: '#ff0000' } })
    if (!withFill.ok) throw new Error('fail')
    const cleared = applyTextureCommand(withFill.template, { op: 'clearFill', target: 'a' })
    expect(cleared.ok).toBe(true); if (!cleared.ok) return
    expect('a' in ((cleared.template.params as any).fills ?? {})).toBe(false)
    expect(applyTextureCommand(state(), { op: 'clearFill', target: 'a' }).ok).toBe(false)
  })
  it('setParam tunes a valid control (clamped) and is invertible', () => {
    const before = state()
    const r = applyTextureCommand(before, { op: 'setParam', target: 'cells', args: { value: 999 } })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(Number(r.template.params.cells)).toBeLessThanOrEqual(40) // clamped to control max
    const undo = applyTextureCommand(r.template, r.inverse)
    if (!undo.ok) throw new Error('fail')
    expect(undo.template.params.cells).toBe(before.params.cells)
  })
  it('setParam rejects an unknown / inactive control', () => {
    expect(applyTextureCommand(state(), { op: 'setParam', target: 'nope', args: { value: 1 } }).ok).toBe(false)
  })
  it('rejects an out-of-vocabulary op', () => {
    expect(applyTextureCommand(state(), { op: 'frobnicate' }).ok).toBe(false)
  })
  it('does not mutate the input', () => {
    const before = state()
    applyTextureCommand(before, { op: 'setFillColor', target: 'a', args: { color: '#ff0000' } })
    expect((before.params as any).fills).toBeUndefined()
  })
})

describe('verifyTexture', () => {
  it('flags two roles that are nearly the same colour', () => {
    let s = state()
    const a = applyTextureCommand(s, { op: 'setFillColor', target: 'a', args: { color: '#808080' } })
    if (!a.ok) throw new Error('fail'); s = a.template
    const b = applyTextureCommand(s, { op: 'setFillColor', target: 'b', args: { color: '#828282' } })
    if (!b.ok) throw new Error('fail')
    expect(verifyTexture(b.template).some(i => /same colour/i.test(i.message))).toBe(true)
  })
  it('a high-contrast two-role tile is clean', () => {
    let s = state()
    const a = applyTextureCommand(s, { op: 'setFillColor', target: 'a', args: { color: '#ffffff' } })
    if (!a.ok) throw new Error('fail'); s = a.template
    const b = applyTextureCommand(s, { op: 'setFillColor', target: 'b', args: { color: '#101010' } })
    if (!b.ok) throw new Error('fail')
    expect(verifyTexture(b.template)).toEqual([])
  })
})

describe('summarizeTextureChange', () => {
  it('summarizes setFillColor with a before/after', () => {
    const sum = summarizeTextureChange(state(), { op: 'setFillColor', target: 'a', args: { color: '#ff0000' } })
    expect(sum?.after).toBe('#ff0000')
  })
})
