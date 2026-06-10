import { ref, computed, watch } from 'vue'
import type { EditState, Track, Clip, Asset, Keyframe } from '~~/shared/timeline/types'
import { createDefaultEditState, computeTotalFrames, migrateEditState } from '~~/shared/timeline/types'
import type { ClipTransform } from '~~/shared/timeline/interpolate'
import { applyCommand, type TimelineCommand } from '~~/shared/timeline/commands'

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
        const migrated = migrateEditState(parsed)
        if (migrated) {
          state.value = migrated
          syncToWidget()   // persist the migrated (v2) shape back
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

  // Single entry point for state mutations: snapshot → apply → sync. A command
  // that can't apply (unknown id, invalid cut) leaves state AND undo untouched.
  function dispatch(cmd: TimelineCommand) {
    pushUndo()
    if (!applyCommand(state.value, cmd)) {
      undoStack.value.pop()
      return
    }
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
    dispatch({
      type: 'add_track',
      track_id: crypto.randomUUID(),
      kind,
      name: name ?? `${kind === 'video' ? 'Video' : 'Audio'} ${count + 1}`,
    })
  }

  function removeTrack(trackId: string) {
    dispatch({ type: 'remove_track', track_id: trackId })
  }

  function addClip(trackId: string, clip: Clip) {
    dispatch({ type: 'add_clip', track_id: trackId, clip })
  }

  function removeClip(clipId: string) {
    dispatch({ type: 'remove_clip', clip_id: clipId })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function updateClip(clipId: string, patch: Partial<Clip>) {
    dispatch({ type: 'update_clip', clip_id: clipId, patch })
  }

  function moveClip(clipId: string, toTrackId: string, newStartFrame: number) {
    dispatch({ type: 'move_clip', clip_id: clipId, to_track_id: toTrackId, start_frame: newStartFrame })
  }

  function splitAtPlayhead(clipId: string) {
    dispatch({ type: 'split_clip', clip_id: clipId, frame: playheadFrame.value, new_clip_id: crypto.randomUUID() })
  }

  function rippleDelete(clipId: string) {
    dispatch({ type: 'ripple_delete', clip_id: clipId })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function setCanvas(patch: Partial<EditState['canvas']>) {
    dispatch({ type: 'set_canvas', patch })
  }

  // -- Keyframes --

  // Playhead position within a clip, in clip-local frames (clamped to the clip).
  function clipLocalFrame(clip: Clip): number {
    return Math.max(0, Math.min(playheadFrame.value - clip.start_frame, Math.max(0, clip.length - 1)))
  }

  // Add (or update) a keyframe at the playhead, capturing the clip's current
  // transform — its static scalars, or the interpolated value if already keyed.
  function addKeyframe(clipId: string) {
    dispatch({ type: 'add_keyframe', clip_id: clipId, frame: playheadFrame.value })
  }

  function removeKeyframeAt(clipId: string, frame: number) {
    dispatch({ type: 'remove_keyframe', clip_id: clipId, frame })
  }

  function moveKeyframe(clipId: string, fromFrame: number, toFrame: number) {
    dispatch({ type: 'move_keyframe', clip_id: clipId, from_frame: fromFrame, to_frame: toFrame })
  }

  function setKeyframeEase(clipId: string, frame: number, ease: Keyframe['ease']) {
    dispatch({ type: 'set_keyframe_ease', clip_id: clipId, frame, ease })
  }

  // Transform edit that respects keyframes: when the clip is keyframed, write to
  // (or create) the keyframe at the playhead; otherwise edit the static scalars.
  // Transform controls call this instead of updateClip.
  function updateClipTransform(clipId: string, patch: Partial<ClipTransform>) {
    dispatch({ type: 'set_clip_transform', clip_id: clipId, frame: playheadFrame.value, patch })
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
    dispatch,
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
