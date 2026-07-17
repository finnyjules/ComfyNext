import type { EditState, Transition, Clip, Track } from './types'

// Junction-transition resolution — the single place that turns the schema's
// Transition objects into per-frame render modulation. Python twin:
// _transition_windows / _transition_mod in comfy_extras/nodes_timeline.py.
// The formulas here are PINNED (golden fixture 05-transitions gates both
// twins); change the two files together.
//
// Model (types.ts): a transition overlaps `duration` frames centered on the
// cut — pre = floor(d/2) frames before, post = d - pre after. Clamps:
//   startF = max(cut - pre, from.start_frame)          (outgoing must exist)
//   endF   = min(cut + post, to.start + to.length)     (incoming must exist)
// During [startF, endF):
//   • the OUTGOING clip stays visible through endF-1 (source clamped to its
//     last local frame once past its end),
//   • the INCOMING clip becomes visible from startF (source clamped to its
//     first local frame before its start) and draws ON TOP with the kind's
//     modulation, weighted by
//       w(g) = (g - startF + 1) / (endF - startF + 1)
//     (never exactly 0 or 1 inside the window).
// Kind modulation of the incoming clip:
//   crossfade  → alphaMul = w
//   wipe_left  → visible where normalized canvas x < w
//   wipe_right → visible where normalized canvas x > 1 - w
//   slide_up   → y offset +(1-w) canvas heights (enters from below)
//   slide_down → y offset -(1-w) canvas heights (enters from above)

export interface TransitionWindow {
  transition: Transition
  cut: number
  startF: number
  /** exclusive */
  endF: number
  fromClipId: string
  toClipId: string
}

export interface TransitionMod {
  /** Render even though `frame` is outside the clip's natural range. */
  visible: boolean
  /** Clip-local frame to use for source mapping (clamped into the clip). */
  localFrame: number
  /** Multiply into the clip's alpha (crossfade weight; 1 otherwise). */
  alphaMul: number
  /** Add to the clip's normalized y BEFORE quantization (slides; 0 otherwise). */
  dy: number
  /** Per-pixel horizontal reveal (wipes; null otherwise). */
  wipe: { mode: 'left' | 'right'; w: number } | null
  /** The clip must paint after this clip id (incoming over outgoing). */
  drawAfter: string | null
}

function findClipOnTrack(track: Track, id: string): Clip | undefined {
  return track.clips.find(c => c.id === id)
}

/** Resolve every valid transition in the state to a concrete frame window.
 *  Invalid entries (missing clips/track, non-adjacent, empty window) drop out. */
export function resolveTransitionWindows(state: EditState): TransitionWindow[] {
  const out: TransitionWindow[] = []
  for (const tr of state.transitions ?? []) {
    const track = state.tracks.find(t => t.id === tr.track_id)
    if (!track) continue
    const from = findClipOnTrack(track, tr.from_clip_id)
    const to = findClipOnTrack(track, tr.to_clip_id)
    if (!from || !to) continue
    const cut = to.start_frame
    if (from.start_frame + from.length !== cut) continue // junction moved — stale
    const d = Math.max(1, Math.round(tr.duration))
    const pre = Math.floor(d / 2)
    const post = d - pre
    const startF = Math.max(cut - pre, from.start_frame)
    const endF = Math.min(cut + post, to.start_frame + to.length)
    if (endF <= startF) continue
    out.push({ transition: tr, cut, startF, endF, fromClipId: from.id, toClipId: to.id })
  }
  return out
}

/** Pinned weight formula — see module header. */
export function transitionWeight(win: TransitionWindow, frame: number): number {
  return (frame - win.startF + 1) / (win.endF - win.startF + 1)
}

/** Per-clip index for fast per-frame lookup. */
export function indexTransitionWindows(windows: TransitionWindow[]): Map<string, TransitionWindow[]> {
  const byClip = new Map<string, TransitionWindow[]>()
  for (const w of windows) {
    for (const id of [w.fromClipId, w.toClipId]) {
      const list = byClip.get(id)
      if (list) list.push(w)
      else byClip.set(id, [w])
    }
  }
  return byClip
}

const IDENTITY_MOD: TransitionMod = {
  visible: false, localFrame: 0, alphaMul: 1, dy: 0, wipe: null, drawAfter: null,
}

/** Modulation for `clip` at global `frame`. `naturallyVisible` = the caller's
 *  own range test (frame ∈ [start, start+length)). Returns IDENTITY (visible:
 *  naturallyVisible) when no window applies. */
export function transitionModAt(
  byClip: Map<string, TransitionWindow[]>,
  clip: Clip,
  frame: number,
  naturallyVisible: boolean,
): TransitionMod {
  const wins = byClip.get(clip.id)
  const localNatural = Math.max(0, Math.min(frame - clip.start_frame, Math.max(1, clip.length) - 1))
  if (!wins) return { ...IDENTITY_MOD, visible: naturallyVisible, localFrame: localNatural }

  for (const win of wins) {
    if (frame < win.startF || frame >= win.endF) continue
    const w = transitionWeight(win, frame)
    if (clip.id === win.toClipId) {
      // Incoming: on top, modulated by kind; source clamps at its head.
      const kind = win.transition.kind
      return {
        visible: true,
        localFrame: Math.max(0, frame - clip.start_frame),
        alphaMul: kind === 'crossfade' ? w : 1,
        dy: kind === 'slide_up' ? (1 - w) : kind === 'slide_down' ? -(1 - w) : 0,
        wipe: kind === 'wipe_left' ? { mode: 'left', w } : kind === 'wipe_right' ? { mode: 'right', w } : null,
        drawAfter: win.fromClipId,
      }
    }
    // Outgoing: keeps rendering through the window; source clamps at its tail.
    return {
      visible: true,
      localFrame: Math.min(Math.max(1, clip.length) - 1, frame - clip.start_frame),
      alphaMul: 1,
      dy: 0,
      wipe: null,
      drawAfter: null,
    }
  }
  return { ...IDENTITY_MOD, visible: naturallyVisible, localFrame: localNatural }
}
