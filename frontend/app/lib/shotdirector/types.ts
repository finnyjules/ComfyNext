// frontend/app/lib/shotdirector/types.ts
// Data model for the Shot Director studio — a structured, editable "intent"
// for a single video shot that compiles to a terse best-practice prompt +
// reference wiring. Persisted at node.data.properties.comfynext_shotDirector.
// Pure data + vocabulary; no Vue/DOM/network here.

export type ShotMode = 'reference' | 'firstLastFrame'

export type ShotType =
  | 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'establishing'

// The 8 canonical camera moves. Exactly one primary move per shot/beat.
export type CameraMove =
  | 'push-in' | 'pull-out' | 'pan' | 'track'
  | 'orbit' | 'aerial' | 'handheld' | 'locked-off'

export type Pacing = 'slow' | 'smooth' | 'gradual' | 'gentle'

export type RefKind = 'image' | 'video' | 'audio'

export type RefRole =
  // image roles
  | 'identity-lock' | 'lighting-copy' | 'composition-lock' | 'style-transfer'
  // scene-context image role — the environment plate (attach/generate). Not a
  // manual dropdown option (absent from ROLES_BY_KIND); the surface sets it
  // directly. Deliberately not composition-lock: use the place, not its framing.
  | 'location'
  // video roles
  | 'camera-copy' | 'motion-transfer' | 'sequence-extend'
  // audio roles
  | 'beat-sync' | 'lip-sync' | 'mood'

export interface Ref {
  kind: RefKind
  /** 1-based slot per kind — renders as [Image{slot}] / [Video{slot}] / [Audio{slot}]. */
  slot: number
  /** data: URL or hosted URL passed to Replicate. */
  src: string
  role: RefRole
  /** freeform refinement folded into the purpose phrase. */
  note?: string
  /** set when this ref was injected from a cast member — materializeCast owns these. */
  castSlug?: string
}

export interface Beat {
  id: string
  startS: number
  endS: number
  action: string
  shotType?: ShotType
  move?: CameraMove
  pacing?: Pacing
  /** slots (per-kind) whose references apply to this beat. */
  activeRefSlots?: number[]
  /** cached preview still (flux-schnell), filled by the UI in a later phase. */
  keyframeUrl?: string
}

export interface DialogueLine {
  speaker?: string
  line: string
}

export interface ShotCamera {
  shotType: ShotType
  move: CameraMove
  pacing: Pacing
}

export interface ShotAudio {
  generate: boolean
  dialogue?: DialogueLine[]
  sfxNote?: string
}

export interface ShotFormat {
  aspectRatio: string   // 'adaptive' excluded for v1 (unsupported by FilmShotNode/_SEEDANCE_AR); surface options in ShotDirectorSurface.vue
  durationS: number     // Seedance set; -1 allowed (intelligent)
  resolution: string
  seed?: number
}

export interface ShotSheet {
  intent: string
  mode: ShotMode

  subject: string
  action: string
  environment: string
  lighting: string
  style: string
  camera: ShotCamera
  constraints: string[]
  cast: CastMember[]

  references: Ref[]
  firstFrame?: string
  lastFrame?: string

  beats: Beat[]
  audio: ShotAudio
  format: ShotFormat
}

// ---- Fixed vocabulary (drives deterministic prose in compile.ts) -----------

export const SHOT_TYPE_PHRASE: Record<ShotType, string> = {
  'wide': 'Wide shot',
  'medium': 'Medium shot',
  'close-up': 'Close-up',
  'extreme-close-up': 'Extreme close-up',
  'establishing': 'Establishing shot',
}

export const CAMERA_MOVE_PHRASE: Record<CameraMove, string> = {
  'push-in': 'push-in',
  'pull-out': 'pull-out',
  'pan': 'pan',
  'track': 'tracking shot',
  'orbit': 'orbit',
  'aerial': 'aerial shot',
  'handheld': 'handheld movement',
  'locked-off': 'locked-off, static camera',
}

export const ROLE_PURPOSE: Record<RefRole, string> = {
  'identity-lock': "the character's identity and wardrobe",
  'location': 'the location and setting',
  'lighting-copy': 'the lighting style',
  'composition-lock': 'the scene composition',
  'style-transfer': 'the visual style',
  'camera-copy': 'the camera movement',
  'motion-transfer': 'the subject motion',
  'sequence-extend': 'continuation from where it ended',
  'beat-sync': 'beat synchronization',
  'lip-sync': 'lip-sync timing',
  'mood': 'the mood and pacing',
}

export const ROLES_BY_KIND: Record<RefKind, RefRole[]> = {
  image: ['identity-lock', 'lighting-copy', 'composition-lock', 'style-transfer'],
  video: ['camera-copy', 'motion-transfer', 'sequence-extend'],
  audio: ['beat-sync', 'lip-sync', 'mood'],
}

export interface CastMember {
  slug: string
  name: string
  via: 'wire' | 'picker'
  /** which of the character's variants to use; omitted = default variant. */
  variantId?: string
}

export function createDefaultShotSheet(): ShotSheet {
  return {
    intent: '',
    mode: 'reference',
    subject: '',
    action: '',
    environment: '',
    lighting: '',
    style: '',
    camera: { shotType: 'medium', move: 'locked-off', pacing: 'smooth' },
    constraints: [],
    cast: [],
    references: [],
    beats: [],
    audio: { generate: true },
    format: { aspectRatio: '16:9', durationS: 5, resolution: '1080p' },
  }
}
