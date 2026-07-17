import { describe, it, expect } from 'vitest'
import {
  resolveTransitionWindows, transitionWeight, indexTransitionWindows, transitionModAt,
} from '../../shared/timeline/transitions'
import { createDefaultEditState, type EditState, type ImageClip, type Transition } from '../../shared/timeline/types'

function img(id: string, start: number, length: number): ImageClip {
  return { id, kind: 'image', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}

function tr(over: Partial<Transition> = {}): Transition {
  return { id: 't-x', track_id: 'trk', from_clip_id: 'a', to_clip_id: 'b', kind: 'crossfade', duration: 10, ...over }
}

function state(clips: ImageClip[], transitions: Transition[]): EditState {
  const s = createDefaultEditState()
  s.tracks[0]!.id = 'trk'
  s.tracks[0]!.clips = clips
  s.transitions = transitions
  return s
}

describe('resolveTransitionWindows', () => {
  it('centers duration on the cut: pre floor(d/2), post d-pre', () => {
    // a: 0..30, b: 30..60, d=10 → window [25, 35)
    const [w] = resolveTransitionWindows(state([img('a', 0, 30), img('b', 30, 30)], [tr()]))
    expect(w).toMatchObject({ cut: 30, startF: 25, endF: 35 })
  })

  it('clamps the tail to the incoming clip end without moving the cut', () => {
    // b only 3 frames long: post half clamps at 33
    const [w] = resolveTransitionWindows(state([img('a', 0, 30), img('b', 30, 3)], [tr()]))
    expect(w).toMatchObject({ startF: 25, endF: 33, cut: 30 })
  })

  it('clamps the head to the outgoing clip start', () => {
    // a starts at 28, only 2 frames before the cut
    const [w] = resolveTransitionWindows(state([img('a', 28, 2), img('b', 30, 30)], [tr()]))
    expect(w).toMatchObject({ startF: 28, endF: 35 })
  })

  it('drops stale transitions when the clips are no longer adjacent', () => {
    expect(resolveTransitionWindows(state([img('a', 0, 30), img('b', 31, 30)], [tr()]))).toEqual([])
  })

  it('drops transitions whose clips are missing', () => {
    expect(resolveTransitionWindows(state([img('a', 0, 30)], [tr()]))).toEqual([])
  })
})

describe('transitionWeight', () => {
  it('is strictly inside (0,1) across the window', () => {
    const win = { startF: 25, endF: 35 } as any
    const ws = Array.from({ length: 10 }, (_, i) => transitionWeight(win, 25 + i))
    expect(Math.min(...ws)).toBeGreaterThan(0)
    expect(Math.max(...ws)).toBeLessThan(1)
    // monotonic
    for (let i = 1; i < ws.length; i++) expect(ws[i]!).toBeGreaterThan(ws[i - 1]!)
    // pinned formula: (g - startF + 1) / (len + 1)
    expect(transitionWeight(win, 25)).toBeCloseTo(1 / 11)
    expect(transitionWeight(win, 34)).toBeCloseTo(10 / 11)
  })
})

describe('transitionModAt', () => {
  const s = state([img('a', 0, 30), img('b', 30, 30)], [tr()])
  const byClip = indexTransitionWindows(resolveTransitionWindows(s))
  const a = s.tracks[0]!.clips[0]!
  const b = s.tracks[0]!.clips[1]!

  it('outgoing clip stays visible past its end with clamped source', () => {
    // frame 32 is past a's end (30) but inside the window
    const mod = transitionModAt(byClip, a, 32, false)
    expect(mod.visible).toBe(true)
    expect(mod.localFrame).toBe(29)  // clamped to length-1
    expect(mod.alphaMul).toBe(1)
  })

  it('incoming clip appears early with clamped source and crossfade alpha', () => {
    const mod = transitionModAt(byClip, b, 26, false)
    expect(mod.visible).toBe(true)
    expect(mod.localFrame).toBe(0)   // before its start → head frame
    expect(mod.alphaMul).toBeCloseTo(transitionWeight({ startF: 25, endF: 35 } as any, 26))
    expect(mod.drawAfter).toBe('a')
  })

  it('outside the window, natural visibility passes through', () => {
    const mod = transitionModAt(byClip, a, 10, true)
    expect(mod.visible).toBe(true)
    expect(mod.localFrame).toBe(10)
    expect(mod.alphaMul).toBe(1)
    const mod2 = transitionModAt(byClip, b, 70, false)
    expect(mod2.visible).toBe(false)
  })

  it('wipes carry the mode and weight; slides carry dy', () => {
    const sw = state([img('a', 0, 30), img('b', 30, 30)],
      [tr({ kind: 'wipe_left' })])
    const idxW = indexTransitionWindows(resolveTransitionWindows(sw))
    const modW = transitionModAt(idxW, sw.tracks[0]!.clips[1]!, 30, true)
    expect(modW.wipe).toMatchObject({ mode: 'left' })
    expect(modW.alphaMul).toBe(1)

    const ss = state([img('a', 0, 30), img('b', 30, 30)],
      [tr({ kind: 'slide_up' })])
    const idxS = indexTransitionWindows(resolveTransitionWindows(ss))
    const modS = transitionModAt(idxS, ss.tracks[0]!.clips[1]!, 30, true)
    const w = transitionWeight({ startF: 25, endF: 35 } as any, 30)
    expect(modS.dy).toBeCloseTo(1 - w)
    expect(modS.wipe).toBeNull()
  })
})
