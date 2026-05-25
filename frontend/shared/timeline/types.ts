export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'soft_light' | 'hard_light' | 'difference'
  | 'lighten' | 'darken' | 'add'

export interface EditState {
  version: 1
  canvas: {
    width: number
    height: number
    fps: number
    bg_color: string
  }
  tracks: Track[]
  total_frames: number
}

export interface Track {
  id: string
  kind: 'video' | 'audio'
  name: string
  muted: boolean
  locked: boolean
  /** Optional per-track height in px. Defaults to TRACK_HEIGHT when unset. */
  height?: number
  clips: Clip[]
}

export interface BaseClip {
  id: string
  kind: string
  start_frame: number
  in_frame: number
  length: number
  x?: number
  y?: number
  rotation?: number
  scale?: number
  opacity?: number
  blend?: BlendMode
  fade_in?: number
  fade_out?: number
  volume?: number
  audio_fade_in?: number
  audio_fade_out?: number
}

export interface VideoClip extends BaseClip {
  kind: 'video'
  asset_id: string
}

export interface ImageClip extends BaseClip {
  kind: 'image'
  asset_id: string
}

export interface AudioClip extends BaseClip {
  kind: 'audio'
  asset_id: string
}

export interface TextSpec {
  text: string
  font_size: number
  color: string
  bg_color: string
  align: 'left' | 'center' | 'right'
  v_align: 'top' | 'middle' | 'bottom'
  padding: number
  line_spacing: number
}

export interface TextClip extends BaseClip {
  kind: 'text'
  text: TextSpec
}

export interface WorkflowClip extends BaseClip {
  kind: 'workflow'
  port_index: number
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip | WorkflowClip

export interface Asset {
  id: string
  path: string
  kind: 'video' | 'image' | 'audio'
  name: string
  duration_sec: number | null
  width: number | null
  height: number | null
  thumbnail_path: string | null
  waveform_path: string | null
}

export function createDefaultEditState(): EditState {
  return {
    version: 1,
    canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
    tracks: [
      { id: crypto.randomUUID(), kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] },
      { id: crypto.randomUUID(), kind: 'audio', name: 'Audio 1', muted: false, locked: false, clips: [] },
    ],
    total_frames: 0,
  }
}

export function computeTotalFrames(state: EditState): number {
  if (state.total_frames > 0) return state.total_frames
  let max = 1
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.start_frame + clip.length)
    }
  }
  return max
}

export function clipsAtFrame(state: EditState, frame: number): { track: Track; clip: Clip }[] {
  const hits: { track: Track; clip: Clip }[] = []
  for (const track of state.tracks) {
    if (track.muted) continue
    for (const clip of track.clips) {
      if (frame >= clip.start_frame && frame < clip.start_frame + clip.length) {
        hits.push({ track, clip })
      }
    }
  }
  return hits
}
