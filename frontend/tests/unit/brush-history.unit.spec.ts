import { describe, it, expect } from 'vitest'
import { createHistory, record, undo, redo, canUndo, canRedo } from '~/lib/brushHistory'

describe('brushHistory', () => {
  it('starts with the initial present and no undo/redo', () => {
    const h = createHistory(0)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('record moves present into the past and updates present', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    expect(h.present).toBe(2)
    expect(canUndo(h)).toBe(true)
    expect(canRedo(h)).toBe(false)
  })

  it('undo restores the prior present and enables redo', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    h = undo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toBe(0)
    expect(canUndo(h)).toBe(false)
  })

  it('redo re-applies an undone state', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = undo(h)
    h = redo(h)
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(false)
  })

  it('a new record after undo clears the redo future', () => {
    let h = createHistory(0)
    h = record(h, 1)
    h = record(h, 2)
    h = undo(h)            // present = 1, future = [2]
    h = record(h, 9)       // diverge
    expect(h.present).toBe(9)
    expect(canRedo(h)).toBe(false)
    h = undo(h)
    expect(h.present).toBe(1)
  })

  it('undo/redo at the ends are no-ops', () => {
    let h = createHistory(0)
    expect(undo(h).present).toBe(0)
    expect(redo(h).present).toBe(0)
  })

  it('does not mutate the input history object', () => {
    const h = createHistory(0)
    const h2 = record(h, 1)
    expect(h.present).toBe(0)
    expect(h2).not.toBe(h)
  })
})
