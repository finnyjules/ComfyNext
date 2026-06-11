export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'soft_light' | 'hard_light' | 'difference'
  | 'lighten' | 'darken' | 'add'

// ── v2 additions: transitions, filters, captions, mattes, bakes ─────────────

/** Built-in junction transitions. Phase-5 generative kinds extend this union. */
export type TransitionKind = 'crossfade' | 'wipe_left' | 'wipe_right' | 'slide_up' | 'slide_down'

/** A transition lives on the junction between two adjacent clips on one track,
 *  overlapping `duration` frames centered on the cut. The overlap spans
 *  `floor(duration/2)` frames before the cut and `duration - floor(duration/2)`
 *  frames after. When a neighboring clip is shorter than its half, the overlap
 *  clamps to the available frames — the cut point never shifts. */
export interface Transition {
  id: string
  track_id: string
  from_clip_id: string
  to_clip_id: string
  kind: TransitionKind
  duration: number
  params?: Record<string, number | string>
}

/** Per-clip color adjustments. Identity when a field is absent:
 *  brightness 0 (additive −1..1), contrast 1 (×, pivot 0.5), saturation 1 (×),
 *  hue 0 (degrees −180..180), temperature 0 (warm/cool −1..1).
 *  Applied in declaration order (brightness → contrast → saturation → hue →
 *  temperature), in sRGB, output clamped to [0,1] after each step. */
export interface ClipFilters {
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
  temperature?: number
}

/** Link to an AI-generated derivative asset (matte, interpolated transition,
 *  reframe). `source_key` hashes the inputs that produced it — mismatch ⇒
 *  stale, re-bake. */
export interface BakeRef {
  asset_id: string
  source_key: string
}

/** Word timing is clip-local frames, like Keyframe.frame. */
export interface CaptionWord {
  text: string
  start_frame: number
  /** Exclusive end frame (half-open interval, matching clipsAtFrame convention). */
  end_frame: number
}

export interface CaptionSpec {
  words: CaptionWord[]
  preset: string
  font_family: string
  font_size: number        // normalized to canvas height (0..1)
  color: string
  highlight_color: string
  /** Vertical anchor 0..1 from top for the text block's layout position; presets
   *  typically use 0.85. The inherited BaseClip transform (x/y/scale/rotation)
   *  composes ON TOP of this anchor. */
  y: number
}

export const EDIT_STATE_VERSION = 2

export interface EditState {
  version: typeof EDIT_STATE_VERSION
  canvas: {
    width: number
    height: number
    fps: number
    bg_color: string
  }
  tracks: Track[]
  /** Transitions attached to clip junctions (v2+). Always present after migration. */
  transitions: Transition[]
  total_frames: number
}

export interface Track {
  id: string
  kind: 'video' | 'audio' | 'captions'
  name: string
  muted: boolean
  locked: boolean
  /** Optional per-track height in px. Defaults to TRACK_HEIGHT when unset. */
  height?: number
  clips: Clip[]
}

/** A keyframe is a full transform snapshot at a clip-local frame. When a clip
 *  has keyframes, they drive x/y/rotation/scale/opacity over time (interpolated);
 *  absent ⇒ the static scalars on the clip are used (back-compat). */
export interface Keyframe {
  frame: number
  x: number; y: number; rotation: number; scale: number; opacity: number
  ease?: 'linear' | 'easeInOut'
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
  /** Animation keyframes (clip-local frames). Present ⇒ transform animates. */
  keyframes?: Keyframe[]
  /** Playback rate (v2). 1 = normal. source_frame = in_frame + floor((frame - start_frame) * speed). */
  speed?: number
  /** Play the source backwards (v2). Applied after speed: the mapped source range plays from its last frame to its first. */
  reverse?: boolean
  /** Per-clip color adjustments (v2). Absent ⇒ identity. */
  filters?: ClipFilters
  /** AI matte asset composited as this clip's alpha (v2). */
  matte_asset_id?: string
  /** Cached AI-generated derivative backing this clip (v2). */
  bake?: BakeRef
}

export interface VideoClip extends BaseClip {
  kind: 'video'
  asset_id: string
  /** File path for the export/render path: absolute, or relative to the ComfyUI input directory. */
  path?: string
}

export interface ImageClip extends BaseClip {
  kind: 'image'
  asset_id: string
  /** File path for the export/render path: absolute, or relative to the ComfyUI input directory. */
  path?: string
}

export interface AudioClip extends BaseClip {
  kind: 'audio'
  asset_id: string
  /** File path for the export/render path: absolute, or relative to the ComfyUI input directory. */
  path?: string
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

// ── Animated typography clips (GSAP-driven) ─────────────────────────────────

export interface TitleSpec {
  text: string
  font_family: string
  font_weight: number
  font_size: number        // normalized to canvas height (0..1)
  color: string
  animation_in: string     // kinetic preset id (e.g. 'stagger-up')
  animation_out: string    // kinetic preset id for exit (e.g. 'fade-out-up')
  hold_frames: number      // frames to hold between in and out animations
  stagger: number          // seconds between animation units
  ease: string             // GSAP ease string
}

export interface TitleClip extends BaseClip {
  kind: 'title'
  title: TitleSpec
}

export type LowerThirdStyle = 'bar' | 'minimal' | 'boxed'

export interface LowerThirdSpec {
  name: string             // primary text (e.g. speaker name)
  subtitle: string         // secondary text (e.g. job title)
  style: LowerThirdStyle
  accent_color: string     // bar/accent color
  text_color: string
  animation_in: 'slide-right' | 'slide-up' | 'fade' | 'wipe'
  hold_frames: number
}

export interface LowerThirdClip extends BaseClip {
  kind: 'lower_third'
  lower_third: LowerThirdSpec
}

/** NOTE: deliberate asymmetry — track kind is plural `'captions'`, clip kind is
 *  singular `'caption'`. Do not "fix" either side; cross-language implementers
 *  must mirror both spellings exactly. */
export interface CaptionClip extends BaseClip {
  kind: 'caption'
  caption: CaptionSpec
}

// ── Motion clip (kinetic timeline) ──────────────────────────────────────────
// A timeline clip whose content is a layer stack evaluated by lib/motion at the
// playhead. v1 holds exactly one text layer. Generalizes later to N layers
// (a Frame on the timeline) and to vector layers — text is the one-layer case.

/** Variable-font axis keyframe, normalized time 0..1 within the clip. */
export interface MotionAxisKeyframe {
  t: number
  axes: Record<string, number>
  ease?: string
}

/** In/out/loop preset animation — structurally mirrors lib/motion's
 *  LayerAnimation so the renderer can pass it straight to evaluateAnimation,
 *  WITHOUT shared/ importing an app/ type (keeps the layering clean). */
export interface MotionLayerAnimation {
  offset: number
  duration?: number
  in?: { presetId: string; duration: number; stagger?: number; ease?: string }
  out?: { presetId: string; duration: number; stagger?: number; ease?: string }
  loop?: { presetId: string; duration: number; stagger?: number; ease?: string }
}

export interface MotionTextLayer {
  id: string
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight?: number
  fontSize: number                 // normalized to canvas WIDTH (lib/motion convention)
  color: string
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  strokeColor?: string
  strokeWidth?: number             // normalized to canvas width
  x?: number; y?: number           // normalized centers; default 0.5/0.5
  /** Base variable-font axis values (wght/wdth/opsz/slnt/custom). */
  axes?: Record<string, number>
  /** Variable-font axis animation (clip-local, normalized 0..1). */
  axisKeyframes?: MotionAxisKeyframe[]
  /** In/out/loop preset animation — structurally compatible with lib/motion's
   *  LayerAnimation (the renderer passes it to evaluateAnimation). */
  animation?: MotionLayerAnimation
}

export interface MotionClip extends BaseClip {
  kind: 'motion'
  layer: MotionTextLayer           // v1: a single text layer
}

export type Clip = VideoClip | ImageClip | AudioClip | TextClip | WorkflowClip | TitleClip | LowerThirdClip | CaptionClip | MotionClip

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
    version: EDIT_STATE_VERSION,
    canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
    tracks: [
      { id: crypto.randomUUID(), kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] },
      { id: crypto.randomUUID(), kind: 'audio', name: 'Audio 1', muted: false, locked: false, clips: [] },
    ],
    transitions: [],
    total_frames: 0,
  }
}

/** Accept any supported stored EditState (v1 widgets/autosaves included) and
 *  normalize it to the current version in place. Returns null when `raw` is
 *  not an edit state — callers fall back to createDefaultEditState(). */
export function migrateEditState(raw: unknown): EditState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, any>
  if (s.version !== 1 && s.version !== EDIT_STATE_VERSION) return null
  if (!s.canvas || typeof s.canvas !== 'object') return null
  if (!Array.isArray(s.tracks)) return null
  s.version = EDIT_STATE_VERSION
  if (!Array.isArray(s.transitions)) s.transitions = []
  return s as EditState
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
