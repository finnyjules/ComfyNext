/**
 * Shot-preset catalog — drives the "Film a shot" node's gallery. Each preset
 * is a complete cinematography recipe (size · angle · movement · lens ·
 * composition); the backend compiles it into model-dialect prompt language.
 *
 * Mirrors comfy_api_nodes/shot_presets.py — keep `id` identical (dispatch key).
 * Adding a preset: append an entry in BOTH files.
 *
 * `thumb` drives the data-only CSS thumbnail in the gallery card (person
 * silhouette + motion arrow + optional overlay). No image assets.
 */

export type ShotCategory = 'movement' | 'angle' | 'lens' | 'composition'

export const SHOT_CATEGORY_LABELS: Record<ShotCategory, string> = {
  movement: 'Movement',
  angle: 'Angle',
  lens: 'Lens',
  composition: 'Composition',
}

export type ShotArrow =
  | 'in' | 'out' | 'up' | 'upright' | 'down' | 'right'
  | 'orbit' | 'shake' | 'dive' | 'flow' | 'rack' | 'none'

export type ShotOverlay =
  | 'doorframe' | 'mirror' | 'blur' | 'streak' | 'shoulder' | 'hands' | 'none'

export interface ShotThumb {
  scale?: number    // person scale (1 = medium); 0 hides the person
  top?: number      // person top offset in % (default 22)
  tilt?: number     // frame tilt in degrees
  arrow?: ShotArrow
  overlay?: ShotOverlay
}

export interface ShotPreset {
  id: string
  label: string
  category: ShotCategory
  recipe: string    // one-line recipe summary shown on the card
  pitch: string     // mood line
  thumb: ShotThumb
}

export const SHOT_PRESETS: ShotPreset[] = [
  // ── Movement ──────────────────────────────────────────────────────────────
  { id: 'push-in', label: 'Slow push-in', category: 'movement',
    recipe: 'MCU · eye level · slow dolly in · 50mm shallow · centered',
    pitch: 'Builds quiet tension', thumb: { scale: 1.3, arrow: 'in' } },
  { id: 'pull-back', label: 'Pull-back reveal', category: 'movement',
    recipe: 'CU → wide · dolly out · 35mm deepening · subject anchored',
    pitch: 'The context lands at the end', thumb: { scale: 0.7, arrow: 'out' } },
  { id: 'crane-reveal', label: 'Crane reveal', category: 'movement',
    recipe: 'Wide · rising low → high · crane up · 24mm deep',
    pitch: 'Establishing grandeur', thumb: { scale: 0.55, top: 40, arrow: 'upright' } },
  { id: 'orbit', label: 'Hero orbit', category: 'movement',
    recipe: 'MS · slow 180° arc · 35mm shallow · subject locked center',
    pitch: 'The hero moment', thumb: { scale: 1, arrow: 'orbit' } },
  { id: 'tracking', label: 'Lateral tracking', category: 'movement',
    recipe: 'MS profile · side-track with subject · 40mm deep · leading room',
    pitch: 'Walk-and-talk energy', thumb: { scale: 1, arrow: 'right' } },
  { id: 'handheld', label: 'Handheld urgency', category: 'movement',
    recipe: 'MCU · shaky handheld follow · 28mm · loose framing',
    pitch: 'Documentary urgency', thumb: { scale: 1.1, tilt: 1.5, arrow: 'shake' } },
  { id: 'dolly-zoom', label: 'Dolly zoom (Vertigo)', category: 'movement',
    recipe: 'MCU · dolly in + zoom out · warping background · centered',
    pitch: 'Reality bends around them', thumb: { scale: 1.2, arrow: 'in', overlay: 'streak' } },
  { id: 'tilt-reveal', label: 'Tilt-up reveal', category: 'movement',
    recipe: 'Feet → face · low angle · slow tilt up · 35mm',
    pitch: 'Sizing them up', thumb: { scale: 1.2, top: 8, arrow: 'up' } },
  { id: 'whip-pan', label: 'Whip pan', category: 'movement',
    recipe: 'MS · violent fast pan, motion-blur streaks · 35mm',
    pitch: 'An energy spike', thumb: { scale: 1, arrow: 'right', overlay: 'streak' } },
  { id: 'crash-zoom', label: 'Crash zoom', category: 'movement',
    recipe: 'Wide → CU · abrupt punch-in zoom · grindhouse',
    pitch: 'An exclamation mark', thumb: { scale: 1.5, top: 12, arrow: 'in' } },
  { id: 'snorricam', label: 'Snorricam', category: 'movement',
    recipe: 'CU body-rigged · face locked, world lurches · 28mm',
    pitch: 'Panic and unraveling', thumb: { scale: 1.4, top: 14, tilt: -4, arrow: 'shake' } },
  { id: 'steadicam-oner', label: 'Steadicam oner', category: 'movement',
    recipe: 'MS following · unbroken glide through spaces · 32mm deep',
    pitch: 'The long-take feel', thumb: { scale: 1, arrow: 'flow' } },
  { id: 'fpv-dive', label: 'FPV drone dive', category: 'movement',
    recipe: 'Wide → tight · plunging aerial dive + weave · ultra-wide',
    pitch: 'Pure adrenaline', thumb: { scale: 0.6, top: 46, arrow: 'dive' } },
  { id: 'aerial-orbit', label: 'Aerial establish orbit', category: 'movement',
    recipe: 'Extreme wide · high aerial · slow drone circle · 24mm deep',
    pitch: 'The opening-credits shot', thumb: { scale: 0.45, top: 48, arrow: 'orbit' } },
  { id: 'ground-rush', label: 'Ground-rush tracking', category: 'movement',
    recipe: 'Low MS · inches off the floor · fast forward skim · 24mm',
    pitch: 'Road-blur menace', thumb: { scale: 0.85, top: 16, arrow: 'in', overlay: 'streak' } },

  // ── Angle ────────────────────────────────────────────────────────────────
  { id: 'god-shot', label: 'Overhead god shot', category: 'angle',
    recipe: 'Wide · directly overhead · slow descend · geometric floor',
    pitch: 'Fate watching from above', thumb: { scale: 0.55, top: 42, arrow: 'down' } },
  { id: 'low-hero', label: 'Low-angle power', category: 'angle',
    recipe: 'MS · strong low angle · slight push · 24mm distortion',
    pitch: 'An imposing entrance', thumb: { scale: 1.35, top: 6, arrow: 'in' } },
  { id: 'dutch', label: 'Dutch drift', category: 'angle',
    recipe: 'MCU · dutch 15° · slow lateral drift · 40mm shallow',
    pitch: 'Something is quietly wrong', thumb: { scale: 1.1, tilt: -8, arrow: 'right' } },
  { id: 'worms-eye', label: "Worm's-eye sky", category: 'angle',
    recipe: 'Extreme low, looking straight up · 18mm · towers swallow the frame',
    pitch: 'Vertigo in reverse', thumb: { scale: 1.25, top: 2, arrow: 'none' } }, // camera rolls; no roll arrow available

  // ── Lens ─────────────────────────────────────────────────────────────────
  { id: 'anamorphic', label: 'Anamorphic dream', category: 'lens',
    recipe: 'MS · slow drift · anamorphic flares, oval bokeh · letterbox',
    pitch: 'Prestige-film sheen', thumb: { scale: 1, overlay: 'streak', arrow: 'none' } },
  { id: 'macro', label: 'Macro detail', category: 'lens',
    recipe: 'ECU · rack focus pull · macro shallow · isolated detail',
    pitch: 'The object tells the story', thumb: { scale: 0, overlay: 'blur', arrow: 'rack' } },
  { id: 'rack-focus', label: 'Rack focus reveal', category: 'lens',
    recipe: 'Two depth planes · static frame, focus pulls front → back · 85mm',
    pitch: 'Attention is the edit', thumb: { scale: 0.9, overlay: 'blur', arrow: 'rack' } },
  { id: 'telephoto', label: 'Telephoto compression', category: 'lens',
    recipe: 'MCU from afar · 300mm stacked planes · blurred passers-by',
    pitch: 'Surveillance distance', thumb: { scale: 0.95, overlay: 'blur', arrow: 'none' } },

  // ── Composition ──────────────────────────────────────────────────────────
  { id: 'locked-off', label: 'Symmetrical one-point', category: 'composition',
    recipe: 'Wide · locked-off static · 32mm deep · dead-center symmetry',
    pitch: 'An unblinking formal stare', thumb: { scale: 0.9, overlay: 'none', arrow: 'none' } }, // dead-center symmetry; thirds grid would contradict
  { id: 'ots', label: 'Over-the-shoulder', category: 'composition',
    recipe: 'MCU · 65mm shallow · framed over a foreground shoulder',
    pitch: 'Conversation intimacy', thumb: { scale: 1, overlay: 'shoulder', arrow: 'none' } },
  { id: 'pov', label: 'POV walk', category: 'composition',
    recipe: 'First person · handheld forward · 28mm · body edges in frame',
    pitch: 'You are there', thumb: { scale: 0, overlay: 'hands', arrow: 'right' } },
  { id: 'voyeur-frame', label: 'Voyeur doorframe', category: 'composition',
    recipe: 'MS · static through doorway slit · 50mm · dark edges crowd in',
    pitch: 'Being watched', thumb: { scale: 0.95, overlay: 'doorframe', arrow: 'none' } },
  { id: 'mirror', label: 'Mirror double', category: 'composition',
    recipe: 'MCU · subject + reflection share frame · 50mm · slow push',
    pitch: 'Two truths at once', thumb: { scale: 0.9, overlay: 'mirror', arrow: 'in' } },
]

export const SHOT_PRESETS_BY_ID: Record<string, ShotPreset> =
  Object.fromEntries(SHOT_PRESETS.map(p => [p.id, p]))

// Fallback for unknown/old workflow preset ids — mirrors DEFAULT_PRESET_ID in
// comfy_api_nodes/shot_presets.py.
export const DEFAULT_SHOT_PRESET_ID = 'push-in'
