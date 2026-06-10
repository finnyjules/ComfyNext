import type { EditState, Track, Clip, Keyframe, Transition } from './types'
import { interpolateClipAt, type ClipTransform } from './interpolate'

// Every timeline mutation is a serializable command applied by `applyCommand`.
// The store dispatches these (wrapping them in undo snapshots); headless
// surfaces — unit tests, the golden harness, the future text-to-edit
// assistant — build the same objects directly. Commands carry explicit frames
// and ids (no playhead, no RNG) so a command log replays deterministically.
//
// Frame conventions:
//   add_keyframe.frame / set_clip_transform.frame — timeline-global frames.
//   remove_keyframe / move_keyframe / set_keyframe_ease — clip-local frames
//   (they address existing Keyframe.frame values).

export type TimelineCommand =
  | { type: 'add_track'; track_id: string; kind: Track['kind']; name: string }
  | { type: 'remove_track'; track_id: string }
  | { type: 'add_clip'; track_id: string; clip: Clip }
  | { type: 'remove_clip'; clip_id: string }
  | { type: 'update_clip'; clip_id: string; patch: Partial<Clip> }
  | { type: 'move_clip'; clip_id: string; to_track_id: string; start_frame: number }
  | { type: 'split_clip'; clip_id: string; frame: number; new_clip_id: string }
  | { type: 'ripple_delete'; clip_id: string }
  | { type: 'set_canvas'; patch: Partial<EditState['canvas']> }
  | { type: 'add_keyframe'; clip_id: string; frame: number }
  | { type: 'remove_keyframe'; clip_id: string; frame: number }
  | { type: 'move_keyframe'; clip_id: string; from_frame: number; to_frame: number }
  | { type: 'set_keyframe_ease'; clip_id: string; frame: number; ease: Keyframe['ease'] }
  | { type: 'set_clip_transform'; clip_id: string; frame: number; patch: Partial<ClipTransform> }
  | { type: 'add_transition'; transition: Transition }
  | { type: 'update_transition'; transition_id: string; patch: Partial<Omit<Transition, 'id'>> }
  | { type: 'remove_transition'; transition_id: string }

function findTrack(s: EditState, trackId: string): Track | null {
  return s.tracks.find(t => t.id === trackId) ?? null
}

function findClip(s: EditState, clipId: string): { track: Track; clip: Clip; index: number } | null {
  for (const track of s.tracks) {
    const index = track.clips.findIndex(c => c.id === clipId)
    if (index >= 0) return { track, clip: track.clips[index]!, index }
  }
  return null
}

function clampLocal(clip: Clip, frame: number): number {
  return Math.max(0, Math.min(Math.round(frame), Math.max(0, clip.length - 1)))
}

/** Snapshot keyframe at clip-local `lf`, capturing the current transform. */
function keyframeAt(clip: Clip, lf: number): Keyframe {
  return { frame: lf, ...interpolateClipAt(clip, lf), ease: 'linear' }
}

/** Apply `cmd` to `s` in place. Returns false (state untouched) when the
 *  command can't apply — unknown ids, out-of-range cuts. */
export function applyCommand(s: EditState, cmd: TimelineCommand): boolean {
  switch (cmd.type) {
    case 'add_track': {
      s.tracks.push({ id: cmd.track_id, kind: cmd.kind, name: cmd.name, muted: false, locked: false, clips: [] })
      return true
    }

    case 'remove_track': {
      if (!findTrack(s, cmd.track_id)) return false
      s.transitions = s.transitions.filter(t => t.track_id !== cmd.track_id)
      s.tracks = s.tracks.filter(t => t.id !== cmd.track_id)
      return true
    }

    case 'add_clip': {
      const track = findTrack(s, cmd.track_id)
      if (!track) return false
      track.clips.push(cmd.clip)
      return true
    }

    case 'remove_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      s.transitions = s.transitions.filter(t => t.from_clip_id !== cmd.clip_id && t.to_clip_id !== cmd.clip_id)
      hit.track.clips.splice(hit.index, 1)
      return true
    }

    case 'update_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      Object.assign(hit.clip, cmd.patch)
      return true
    }

    case 'move_clip': {
      const hit = findClip(s, cmd.clip_id)
      const target = findTrack(s, cmd.to_track_id)
      if (!hit || !target) return false
      hit.track.clips.splice(hit.index, 1)
      hit.clip.start_frame = Math.max(0, Math.round(cmd.start_frame))
      target.clips.push(hit.clip)
      return true
    }

    case 'split_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const { track, clip, index } = hit
      if (cmd.frame <= clip.start_frame || cmd.frame >= clip.start_frame + clip.length) return false

      const splitPoint = cmd.frame - clip.start_frame
      const right: Clip = {
        ...JSON.parse(JSON.stringify(clip)),
        id: cmd.new_clip_id,
        start_frame: cmd.frame,
        in_frame: (clip.in_frame ?? 0) + splitPoint,
        length: clip.length - splitPoint,
      }

      // Keyframes are clip-local: the left half keeps those before the cut,
      // the right half keeps those after, rebased to its new local origin.
      if (clip.keyframes?.length) {
        const leftKfs = clip.keyframes.filter(k => k.frame < splitPoint)
        const rightKfs = clip.keyframes
          .filter(k => k.frame >= splitPoint)
          .map(k => ({ ...k, frame: k.frame - splitPoint }))
        if (leftKfs.length) clip.keyframes = leftKfs
        else delete clip.keyframes
        if (rightKfs.length) right.keyframes = rightKfs
        else delete right.keyframes
      }

      clip.length = splitPoint
      // The end junction now belongs to the right half.
      for (const t of s.transitions) {
        if (t.from_clip_id === cmd.clip_id) t.from_clip_id = cmd.new_clip_id
      }
      track.clips.splice(index + 1, 0, right)
      return true
    }

    case 'ripple_delete': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const { track, clip, index } = hit
      const gap = clip.length
      const after = clip.start_frame
      s.transitions = s.transitions.filter(t => t.from_clip_id !== cmd.clip_id && t.to_clip_id !== cmd.clip_id)
      track.clips.splice(index, 1)
      for (const c of track.clips) {
        if (c.start_frame > after) c.start_frame -= gap
      }
      return true
    }

    case 'set_canvas': {
      Object.assign(s.canvas, cmd.patch)
      return true
    }

    case 'add_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const clip = hit.clip
      const lf = clampLocal(clip, cmd.frame - clip.start_frame)
      const kf = keyframeAt(clip, lf)
      if (!clip.keyframes) clip.keyframes = []
      const i = clip.keyframes.findIndex(k => k.frame === lf)
      if (i >= 0) clip.keyframes[i] = { ...clip.keyframes[i], ...kf }
      else clip.keyframes.push(kf)
      clip.keyframes.sort((a, b) => a.frame - b.frame)
      return true
    }

    case 'remove_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit?.clip.keyframes) return false
      const before = hit.clip.keyframes.length
      hit.clip.keyframes = hit.clip.keyframes.filter(k => k.frame !== cmd.frame)
      if (!hit.clip.keyframes.length) delete hit.clip.keyframes
      return hit.clip.keyframes?.length !== before
    }

    case 'move_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      const k = hit?.clip.keyframes?.find(kf => kf.frame === cmd.from_frame)
      if (!hit || !k) return false
      k.frame = clampLocal(hit.clip, cmd.to_frame)
      hit.clip.keyframes!.sort((a, b) => a.frame - b.frame)
      return true
    }

    case 'set_keyframe_ease': {
      const hit = findClip(s, cmd.clip_id)
      const k = hit?.clip.keyframes?.find(kf => kf.frame === cmd.frame)
      if (!k) return false
      k.ease = cmd.ease
      return true
    }

    case 'set_clip_transform': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const clip = hit.clip
      if (clip.keyframes && clip.keyframes.length) {
        const lf = clampLocal(clip, cmd.frame - clip.start_frame)
        let k = clip.keyframes.find(kf => kf.frame === lf)
        if (!k) {
          k = keyframeAt(clip, lf)
          clip.keyframes.push(k)
          clip.keyframes.sort((a, b) => a.frame - b.frame)
        }
        Object.assign(k, cmd.patch)
      } else {
        Object.assign(clip, cmd.patch)
      }
      return true
    }

    case 'add_transition': {
      const t = cmd.transition
      if (!findClip(s, t.from_clip_id) || !findClip(s, t.to_clip_id)) return false
      // One transition per junction: replace any existing one on the same pair.
      s.transitions = s.transitions.filter(x => !(x.from_clip_id === t.from_clip_id && x.to_clip_id === t.to_clip_id))
      s.transitions.push(t)
      return true
    }

    case 'update_transition': {
      const t = s.transitions.find(x => x.id === cmd.transition_id)
      if (!t) return false
      Object.assign(t, cmd.patch)
      return true
    }

    case 'remove_transition': {
      const before = s.transitions.length
      s.transitions = s.transitions.filter(x => x.id !== cmd.transition_id)
      return s.transitions.length !== before
    }
  }
}
