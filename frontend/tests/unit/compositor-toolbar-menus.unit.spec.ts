import { describe, it, expect } from 'vitest'
import {
  TOOLBAR_SHAPES, TOOLBAR_AI, DEFAULT_SHAPE_FACE,
  resolveShapeFace, shapeFaceLabel, smartSelectRowState,
} from '~/lib/compositor/toolbarMenus'

describe('compositor toolbar menus', () => {
  it('pins the shapes menu contents and order', () => {
    expect(TOOLBAR_SHAPES.map(s => s.id)).toEqual(['rect', 'ellipse', 'line', 'polygon', 'star'])
    expect(TOOLBAR_SHAPES.map(s => s.label)).toEqual(['Rectangle', 'Ellipse', 'Line', 'Polygon', 'Star'])
  })

  it('defaults the face to Rectangle', () => {
    expect(DEFAULT_SHAPE_FACE).toBe('rect')
    expect(resolveShapeFace(null)).toBe('rect')
    expect(resolveShapeFace(undefined)).toBe('rect')
    expect(resolveShapeFace('nope')).toBe('rect')
    expect(shapeFaceLabel(null)).toBe('Rectangle')
  })

  it('keeps a picked shape as the face', () => {
    for (const s of TOOLBAR_SHAPES) expect(resolveShapeFace(s.id)).toBe(s.id)
    expect(shapeFaceLabel('star')).toBe('Star')
  })

  it('pins the AI menu contents and order', () => {
    expect(TOOLBAR_AI.map(r => r.id)).toEqual(['vector', 'region', 'smart'])
    expect(TOOLBAR_AI.map(r => r.label)).toEqual(['AI vector', 'Generate in region', 'Smart select'])
    for (const r of TOOLBAR_AI) expect(r.hint.length).toBeGreaterThan(10)
  })

  it('disables the Smart select row without an image selection', () => {
    const off = smartSelectRowState(false, false)
    expect(off.disabled).toBe(true)
    expect(off.hint).toBe('Select an image layer first')

    // With an image selected, or while smart select is already running (so it
    // can be switched off from the same row), it stays live.
    expect(smartSelectRowState(true, false).disabled).toBe(false)
    expect(smartSelectRowState(false, true).disabled).toBe(false)
    expect(smartSelectRowState(true, false).hint).toBe(TOOLBAR_AI[2]!.hint)
  })
})
