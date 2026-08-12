import { describe, it, expect } from 'vitest'
import { defaultSpaceTypeState, dimsFromState, texOptsFromState } from '~/lib/spacetype/state'
import { defaultsFromControls } from '~/lib/spacetype/effect'
import { getEffect } from '~/lib/spacetype/effects'
import type { SpaceTypeState } from '~~/shared/spacetype/state'

// Regression: a Type Studio scene saved with Custom dims (portrait) rendered
// landscape when wired into a Frame, and multi-line text collapsed into ONE
// atlas row so every stripe showed all strings concatenated. Both came from
// the node/timeline path (state.ts) drifting from the surface's inline logic.

function stateFor(effectId: string, over: Partial<SpaceTypeState> = {}): SpaceTypeState {
  return {
    ...defaultSpaceTypeState(),
    effectId,
    params: { ...defaultsFromControls(getEffect(effectId).controls) },
    ...over,
  }
}

describe('dimsFromState', () => {
  it('prefers explicit W/H (Custom dims) over the preset key', () => {
    const s = stateFor('stripes', { dimsKey: 'Custom', W: 1024, H: 1280 })
    expect(dimsFromState(s)).toEqual([1024, 1280])
  })

  it('falls back to the preset table when no explicit W/H is saved', () => {
    const s = stateFor('stripes', { dimsKey: '1080 × 1920 (9:16)' })
    expect(dimsFromState(s)).toEqual([1080, 1920])
  })

  it('falls back to 960×540 for an unknown key without W/H', () => {
    const s = stateFor('stripes', { dimsKey: 'Custom' })
    expect(dimsFromState(s)).toEqual([960, 540])
  })
})

describe('texOptsFromState multi-text atlas', () => {
  it('splits multi-line text into one label per row for textList effects', () => {
    const s = stateFor('stripes')
    s.params.text = 'World Champion\nChampion du Monde\nRey del Mundo'
    const opts = texOptsFromState(s)
    expect(opts.labels).toEqual(['WORLD CHAMPION   ', 'CHAMPION DU MONDE   ', 'REY DEL MUNDO   '])
    expect(opts.label).toBe(opts.labels[0])
  })

  it('collapses to the first line for effects without a textList control', () => {
    const s = stateFor('echo')
    s.params.text = 'ECHO\nIGNORED'
    const opts = texOptsFromState(s)
    // echo is a raw-word effect: no trailing tile gap either.
    expect(opts.labels).toEqual(['ECHO'])
  })

  it('keeps raw words (no trailing gap) for coil-family effects', () => {
    const s = stateFor('coil')
    s.params.text = 'this & then\nagain'
    const opts = texOptsFromState(s)
    expect(opts.labels).toEqual(['THIS & THEN', 'AGAIN'])
  })

  it('honors textCase asis', () => {
    const s = stateFor('stripes')
    s.params.text = 'MiXeD'
    s.params.textCase = 'asis'
    const opts = texOptsFromState(s)
    expect(opts.labels).toEqual(['MiXeD   '])
  })

  it('supersamples the atlas like the surface does (2× default, 3× slit-scan)', () => {
    const stripes = texOptsFromState(stateFor('stripes'))
    expect(stripes.heightPx).toBe(512)
    const slit = texOptsFromState(stateFor('slitscan'))
    expect(slit.heightPx).toBe(768)
  })
})
