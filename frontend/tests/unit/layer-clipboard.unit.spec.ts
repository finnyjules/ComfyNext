import { beforeEach, describe, expect, it } from 'vitest'
import { _resetClipboard, extractForCopy, getClipboard, hasClipboard, materializePaste, setClipboard } from '../../app/lib/compositor/layerClipboard'

const L = (id: string, x: number, y: number, groupId?: string): any => ({ id, kind: 'rect', x, y, rotation: 0, opacity: 1, w: 0.1, h: 0.1, ...(groupId ? { groupId } : {}) })
const ids = () => { let n = 0; return () => `p${++n}` }
const gids = () => { let n = 0; return () => `pg${++n}` }

describe('extractForCopy', () => {
  it('deep-clones the selected layers + referenced groups', () => {
    const src: any = { ...L('a', 0.2, 0.2, 'g1'), effects: [{ blur: 4 }] }
    const p = extractForCopy([src, L('b', 0.5, 0.5)], [{ id: 'g1', name: 'Row' }, { id: 'gX' }], new Set(['a']))!
    expect(p.layers).toHaveLength(1)
    expect(p.groups).toEqual([{ id: 'g1', name: 'Row' }])
    ;(p.layers[0] as any).effects[0].blur = 99
    expect(src.effects[0].blur).toBe(4) // independent clone
  })
  it('returns null for an empty selection', () => {
    expect(extractForCopy([L('a', 0.2, 0.2)], [], new Set())).toBeNull()
  })
})

describe('materializePaste', () => {
  it('re-ids, offsets in x+y, appends on top, selection = the new ids', () => {
    const payload = { layers: [L('a', 0.2, 0.2)], groups: [] }
    const r = materializePaste(payload, [L('z', 0.9, 0.9)], [], 0.02, ids(), gids())
    expect(r.layers).toHaveLength(2)
    expect(r.newIds).toEqual(['p1'])
    expect(r.layers[1]).toMatchObject({ id: 'p1', x: 0.22, y: 0.22 })
  })
  it('in-place paste (offset 0) keeps position', () => {
    const r = materializePaste({ layers: [L('a', 0.3, 0.3)], groups: [] }, [], [], 0, ids(), gids())
    expect(r.layers[0]).toMatchObject({ x: 0.3, y: 0.3 })
  })
  it('mints one fresh group id per source group and carries its name', () => {
    const payload = { layers: [L('a', 0.2, 0.2, 'g1'), L('b', 0.3, 0.3, 'g1')], groups: [{ id: 'g1', name: 'Row' }] }
    const r = materializePaste(payload, [], [], 0.02, ids(), gids())
    const copies = r.layers
    expect(copies[0].groupId).toBe('pg1')
    expect(copies[1].groupId).toBe('pg1')
    expect(r.groups).toContainEqual({ id: 'pg1', name: 'Row' })
  })
})

describe('clipboard singleton', () => {
  beforeEach(() => _resetClipboard())
  it('set / get / has round-trip', () => {
    expect(hasClipboard()).toBe(false)
    setClipboard({ layers: [L('a', 0.2, 0.2)], groups: [] })
    expect(hasClipboard()).toBe(true)
    expect(getClipboard()!.layers).toHaveLength(1)
  })
  it('an empty payload is not "has"', () => {
    setClipboard({ layers: [], groups: [] })
    expect(hasClipboard()).toBe(false)
  })
})
