import { ref, computed, watch } from 'vue'
import type { EditState, Track, Clip, Asset, Keyframe } from '~~/shared/timeline/types'
import { createDefaultEditState, computeTotalFrames } from '~~/shared/timeline/types'
import { interpolateClipAt, type ClipTransform } from '~~/shared/timeline/interpolate'

const MAX_UNDO = 100

const state = ref<EditState>(createDefaultEditState())
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])

const playhead = ref(0)
const isPlaying = ref(false)
const selectedClipId = ref<string | null>(null)
const selectedTrackId = ref<string | null>(null)

let _nodeId: string | null = null
let _getValue: ((name: string) => any) | null = null
let _setValue: ((name: string, v: any) => void) | null = null

function pushUndo() {
  undoStack.value.push(JSON.stringify(state.value))
  if (undoStack.value.length > MAX_UNDO) undoStack.value.shift()
  redoStack.value = []
}

function syncToWidget() {
  if (_setValue) _setValue('edit_state', JSON.stringify(state.value))
}

export function useTimelineStore() {
  const totalFrames = computed(() => computeTotalFrames(state.value))
  const fps = computed(() => state.value.canvas.fps)
  const totalSec = computed(() => totalFrames.value / fps.value)
  const playheadFrame = computed(() => Math.floor(playhead.value * fps.value))

  const selectedClip = computed(() => {
    if (!selectedClipId.value) return null
    for (const track of state.value.tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId.value)
      if (clip) return clip
    }
    return null
  })

  const selectedTrack = computed(() => {
    if (!selectedTrackId.value) return null
    return state.value.tracks.find(t => t.id === selectedTrackId.value) ?? null
  })

  function bind(nodeId: string, getValue: (name: string) => any, setValue: (name: string, v: any) => void) {
    _nodeId = nodeId
    _getValue = getValue
    _setValue = setValue
    const raw = getValue('edit_state')
    if (raw) {
      try {
        const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
        if (parsed?.version === 1) {
          state.value = parsed
          return
        }
      } catch {}
    }
    state.value = createDefaultEditState()
    syncToWidget()
  }

  function unbind() {
    _nodeId = null
    _getValue = null
    _setValue = null
  }

  // -- Mutations (all push undo + sync) --

  function mutate(fn: (s: EditState) => void) {
    pushUndo()
    fn(state.value)
    syncToWidget()
  }

  function undo() {
    const prev = undoStack.value.pop()
    if (!prev) return
    redoStack.value.push(JSON.stringify(state.value))
    state.value = JSON.parse(prev)
    syncToWidget()
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(JSON.stringify(state.value))
    state.value = JSON.parse(next)
    syncToWidget()
  }

  function addTrack(kind: 'video' | 'audio', name?: string) {
    const count = state.value.tracks.filter(t => t.kind === kind).length
    mutate(s => {
      s.tracks.push({
        id: crypto.randomUUID(),
        kind,
        name: name ?? `${kind === 'video' ? 'Video' : 'Audio'} ${count + 1}`,
        muted: false,
        locked: false,
        clips: [],
      })
    })
  }

  function removeTrack(trackId: string) {
    mutate(s => {
      s.tracks = s.tracks.filter(t => t.id !== trackId)
    })
  }

  function addClip(trackId: string, clip: Clip) {
    mutate(s => {
      const track = s.tracks.find(t => t.id === trackId)
      if (track) track.clips.push(clip)
    })
  }

  function removeClip(clipId: string) {
    mutate(s => {
      for (const track of s.tracks) {
        track.clips = track.clips.filter(c => c.id !== clipId)
      }
    })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function updateClip(clipId: string, patch: Partial<Clip>) {
    mutate(s => {
      for (const track of s.tracks) {
        const clip = track.clips.find(c => c.id === clipId)
        if (clip) {
          Object.assign(clip, patch)
          return
        }
      }
    })
  }

  function moveClip(clipId: string, toTrackId: string, newStartFrame: number) {
    mutate(s => {
      let clip: Clip | undefined
      for (const track of s.tracks) {
        const idx = track.clips.findIndex(c => c.id === clipId)
        if (idx >= 0) {
          clip = track.clips.splice(idx, 1)[0]
          break
        }
      }
      if (!clip) return
      clip.start_frame = Math.max(0, newStartFrame)
      const target = s.tracks.find(t => t.id === toTrackId)
      if (target) target.clips.push(clip)
    })
  }

  function splitAtPlayhead(clipId: string) {
    const frame = playheadFrame.value
    mutate(s => {
      for (const track of s.tracks) {
        const idx = track.clips.findIndex(c => c.id === clipId)
        if (idx < 0) continue
        const clip = track.clips[idx]
        if (frame <= clip.start_frame || frame >= clip.start_frame + clip.length) return

        const splitPoint = frame - clip.start_frame
        const rightClip: Clip = {
          ...JSON.parse(JSON.stringify(clip)),
          id: crypto.randomUUID(),
          start_frame: frame,
          in_frame: (clip.in_frame ?? 0) + splitPoint,
          length: clip.length - splitPoint,
        }
        clip.length = splitPoint
        track.clips.splice(idx + 1, 0, rightClip)
        return
      }
    })
  }

  function rippleDelete(clipId: string) {
    mutate(s => {
      for (const track of s.tracks) {
        const idx = track.clips.findIndex(c => c.id === clipId)
        if (idx < 0) continue
        const clip = track.clips[idx]
        const gap = clip.length
        const after = clip.start_frame
        track.clips.splice(idx, 1)
        for (const c of track.clips) {
          if (c.start_frame > after) c.start_frame -= gap
        }
        return
      }
    })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function setCanvas(patch: Partial<EditState['canvas']>) {
    mutate(s => { Object.assign(s.canvas, patch) })
  }

  // -- Keyframes --

  // Playhead position within a clip, in clip-local frames (clamped to the clip).
  function clipLocalFrame(clip: Clip): number {
    return Math.max(0, Math.min(playheadFrame.value - clip.start_frame, Math.max(0, clip.length - 1)))
  }

  // Add (or update) a keyframe at the playhead, capturing the clip's current
  // transform — its static scalars, or the interpolated value if already keyed.
  function addKeyframe(clipId: string) {
    mutate(s => {
      for (const track of s.tracks) {
        const clip = track.clips.find(c => c.id === clipId)
        if (!clip) continue
        const lf = clipLocalFrame(clip)
        const kf: Keyframe = { frame: lf, ...interpolateClipAt(clip, lf), ease: 'linear' }
        if (!clip.keyframes) clip.keyframes = []
        const i = clip.keyframes.findIndex(k => k.frame === lf)
        if (i >= 0) clip.keyframes[i] = { ...clip.keyframes[i], ...kf }
        else clip.keyframes.push(kf)
        clip.keyframes.sort((a, b) => a.frame - b.frame)
        return
      }
    })
  }

  function removeKeyframeAt(clipId: string, frame: number) {
    mutate(s => {
      for (const track of s.tracks) {
        const clip = track.clips.find(c => c.id === clipId)
        if (!clip?.keyframes) continue
        clip.keyframes = clip.keyframes.filter(k => k.frame !== frame)
        if (!clip.keyframes.length) delete clip.keyframes
        return
      }
    })
  }

  function moveKeyframe(clipId: string, fromFrame: number, toFrame: number) {
    mutate(s => {
      for (const track of s.tracks) {
        const clip = track.clips.find(c => c.id === clipId)
        const k = clip?.keyframes?.find(kf => kf.frame === fromFrame)
        if (!clip || !k) continue
        k.frame = Math.max(0, Math.min(Math.round(toFrame), Math.max(0, clip.length - 1)))
        clip.keyframes!.sort((a, b) => a.frame - b.frame)
        return
      }
    })
  }

  function setKeyframeEase(clipId: string, frame: number, ease: Keyframe['ease']) {
    mutate(s => {
      for (const track of s.tracks) {
        const k = track.clips.find(c => c.id === clipId)?.keyframes?.find(kf => kf.frame === frame)
        if (k) { k.ease = ease; return }
      }
    })
  }

  // Transform edit that respects keyframes: when the clip is keyframed, write to
  // (or create) the keyframe at the playhead; otherwise edit the static scalars.
  // Transform controls call this instead of updateClip.
  function updateClipTransform(clipId: string, patch: Partial<ClipTransform>) {
    mutate(s => {
      for (const track of s.tracks) {
        const clip = track.clips.find(c => c.id === clipId)
        if (!clip) continue
        if (clip.keyframes && clip.keyframes.length) {
          const lf = clipLocalFrame(clip)
          let k = clip.keyframes.find(kf => kf.frame === lf)
          if (!k) {
            k = { frame: lf, ...interpolateClipAt(clip, lf), ease: 'linear' }
            clip.keyframes.push(k)
            clip.keyframes.sort((a, b) => a.frame - b.frame)
          }
          Object.assign(k, patch)
        } else {
          Object.assign(clip, patch)
        }
        return
      }
    })
  }

  // -- Playback transport --

  let playStartedAt = 0
  let playStartedAtPlayhead = 0

  function play() {
    if (isPlaying.value) return
    isPlaying.value = true
    playStartedAt = performance.now()
    playStartedAtPlayhead = playhead.value
  }

  function pause() {
    isPlaying.value = false
  }

  function togglePlay() {
    if (isPlaying.value) pause()
    else play()
  }

  function seek(seconds: number) {
    playhead.value = Math.max(0, Math.min(seconds, totalSec.value))
    if (isPlaying.value) {
      playStartedAt = performance.now()
      playStartedAtPlayhead = playhead.value
    }
  }

  function seekFrame(frame: number) {
    seek(frame / fps.value)
  }

  function stepFrames(delta: number) {
    seek(playhead.value + delta / fps.value)
  }

  function tickPlayhead() {
    if (!isPlaying.value) return
    const elapsed = (performance.now() - playStartedAt) / 1000
    let next = playStartedAtPlayhead + elapsed
    if (next >= totalSec.value) {
      next = 0
      playStartedAt = performance.now()
      playStartedAtPlayhead = 0
    }
    playhead.value = next
  }

  return {
    state,
    playhead,
    isPlaying,
    selectedClipId,
    selectedTrackId,
    selectedClip,
    selectedTrack,
    totalFrames,
    totalSec,
    fps,
    playheadFrame,

    bind,
    unbind,
    mutate,
    undo,
    redo,
    canUndo: computed(() => undoStack.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),

    addTrack,
    removeTrack,
    addClip,
    removeClip,
    updateClip,
    moveClip,
    splitAtPlayhead,
    rippleDelete,
    setCanvas,
    clipLocalFrame,
    addKeyframe,
    removeKeyframeAt,
    moveKeyframe,
    setKeyframeEase,
    updateClipTransform,

    play,
    pause,
    togglePlay,
    seek,
    seekFrame,
    stepFrames,
    tickPlayhead,
  }
}
