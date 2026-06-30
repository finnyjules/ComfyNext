import { describe, expect, it } from 'vitest'
import { solveStack } from '../../shared/template-grid/autolayout'
import type { StackBox, StackItem } from '../../shared/template-grid/autolayout'

const box = (over: Partial<StackBox> = {}): StackBox => ({
  x: 0, y: 0, w: 100, h: 100, direction: 'vertical',
  padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, gap: 0,
  mainAlign: 'start', crossAlign: 'stretch', ...over,
})
const item = (id: string, over: Partial<StackItem> = {}): StackItem => ({
  id, main: 20, cross: 20, mainMode: 'fixed', crossMode: 'stretch', ...over,
})

describe('solveStack', () => {
  it('stacks vertical fixed children top-down', () => {
    const out = solveStack(box(), [item('a', { main: 30 }), item('b', { main: 40 })])
    expect(out[0].rect).toEqual({ x: 0, y: 0, w: 100, h: 30 })
    expect(out[1].rect).toEqual({ x: 0, y: 30, w: 100, h: 40 })
  })

  it('applies padding and gap', () => {
    const out = solveStack(box({ padTop: 10, padLeft: 5, padRight: 5, gap: 8 }),
      [item('a', { main: 20 }), item('b', { main: 20 })])
    expect(out[0].rect).toEqual({ x: 5, y: 10, w: 90, h: 20 })
    expect(out[1].rect).toEqual({ x: 5, y: 38, w: 90, h: 20 }) // 10 + 20 + 8
  })

  it('distributes fill children across leftover main space', () => {
    const out = solveStack(box({ h: 100 }),
      [item('a', { main: 40, mainMode: 'fixed' }), item('b', { mainMode: 'fill' })])
    expect(out[1].rect.h).toBe(60)
    expect(out[1].rect.y).toBe(40)
  })

  it('splits fill equally between two fill children', () => {
    const out = solveStack(box({ h: 90, gap: 10 }),
      [item('a', { mainMode: 'fill' }), item('b', { mainMode: 'fill' })])
    expect(out[0].rect.h).toBe(40) // (90 - 10) / 2
    expect(out[1].rect.h).toBe(40)
  })

  it('centers on the main axis', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'center' }), [item('a', { main: 20 })])
    expect(out[0].rect.y).toBe(40)
  })

  it('aligns to end on the main axis', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'end' }), [item('a', { main: 20 })])
    expect(out[0].rect.y).toBe(80)
  })

  it('space-between pushes children to the extremes', () => {
    const out = solveStack(box({ h: 100, mainAlign: 'space-between' }),
      [item('a', { main: 20 }), item('b', { main: 20 })])
    expect(out[0].rect.y).toBe(0)
    expect(out[1].rect.y).toBe(80)
  })

  it('cross start/center/end honor intrinsic cross size', () => {
    const start = solveStack(box({ crossAlign: 'start' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(start[0].rect).toMatchObject({ x: 0, w: 40 })
    const center = solveStack(box({ crossAlign: 'center' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(center[0].rect).toMatchObject({ x: 30, w: 40 })
    const end = solveStack(box({ crossAlign: 'end' }), [item('a', { cross: 40, crossMode: 'hug' })])
    expect(end[0].rect).toMatchObject({ x: 60, w: 40 })
  })

  it('cross stretch fills the cross extent', () => {
    const out = solveStack(box({ crossAlign: 'start' }), [item('a', { cross: 40, crossMode: 'stretch' })])
    expect(out[0].rect).toMatchObject({ x: 0, w: 100 })
  })

  it('lays out horizontally on the x axis', () => {
    const out = solveStack(box({ direction: 'horizontal', w: 100 }),
      [item('a', { main: 30 }), item('b', { main: 30 })])
    expect(out[0].rect).toMatchObject({ x: 0, w: 30 })
    expect(out[1].rect).toMatchObject({ x: 30, w: 30 })
  })

  it('handles empty children', () => {
    expect(solveStack(box(), [])).toEqual([])
  })

  it('never makes fill negative when content overflows', () => {
    const out = solveStack(box({ h: 30 }),
      [item('a', { main: 40, mainMode: 'fixed' }), item('b', { mainMode: 'fill' })])
    expect(out[1].rect.h).toBe(0)
  })
})
