import { describe, expect, it } from 'vitest'
import { resolveGroupCascade, upsertGroup, type LayerGroup } from '../../app/lib/compositor/layerGroups'

describe('resolveGroupCascade', () => {
  it('no group → identity', () => {
    expect(resolveGroupCascade(undefined, [])).toEqual({ opacity: 1, hidden: false, locked: false })
  })
  it('single group multiplies opacity', () => {
    expect(resolveGroupCascade('g', [{ id: 'g', opacity: 0.5 }])).toMatchObject({ opacity: 0.5 })
  })
  it('nested groups multiply opacity', () => {
    const gs: LayerGroup[] = [{ id: 'child', parentId: 'parent', opacity: 0.5 }, { id: 'parent', opacity: 0.5 }]
    expect(resolveGroupCascade('child', gs).opacity).toBeCloseTo(0.25)
  })
  it('hidden/locked OR up the chain', () => {
    const gs: LayerGroup[] = [{ id: 'child', parentId: 'parent' }, { id: 'parent', hidden: true, locked: true }]
    expect(resolveGroupCascade('child', gs)).toMatchObject({ hidden: true, locked: true })
  })
  it('missing registry entry (implicit group) contributes nothing', () => {
    expect(resolveGroupCascade('ghost', [])).toEqual({ opacity: 1, hidden: false, locked: false })
  })
})

describe('upsertGroup', () => {
  it('updates an existing entry, preserving other fields', () => {
    const out = upsertGroup([{ id: 'g', name: 'Row' }], 'g', { hidden: true })
    expect(out).toContainEqual({ id: 'g', name: 'Row', hidden: true })
  })
  it('appends when absent', () => {
    const out = upsertGroup([], 'g', { opacity: 0.4 })
    expect(out).toContainEqual({ id: 'g', opacity: 0.4 })
  })
  it('does not mutate the input array', () => {
    const src: LayerGroup[] = [{ id: 'g' }]
    upsertGroup(src, 'g', { locked: true })
    expect(src).toEqual([{ id: 'g' }])
  })
})
