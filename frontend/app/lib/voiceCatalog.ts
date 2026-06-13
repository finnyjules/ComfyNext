/**
 * voiceCatalog — display metadata for the MiniMax Speech-02 system voices used
 * by the "Generate speech" node (GenerateSpeechNode.voice_id).
 *
 * The node still selects + serializes a plain voice-id string; this catalog only
 * enriches those ids for the voice gallery: a humanized label, a category for the
 * filter chips, and the URL of the pre-baked preview clip served from
 * `frontend/public/voice-samples/<id>.mp3` (see scripts/bake_voice_samples.py).
 *
 * Source of truth for the id list is the backend `_MINIMAX_VOICES` in
 * comfy_api_nodes/nodes_replicate.py. The gallery intersects this catalog with
 * the node's actual combo options (`voicesForOptions`), so a backend list change
 * never leaves a dangling card — unknown ids degrade to a preview-less entry.
 */

export type VoiceCategory = 'Female' | 'Male' | 'Character'

export interface VoiceMeta {
  id: string
  label: string
  category: VoiceCategory
  /** Pre-baked preview clip, or null when no sample exists (unknown voice). */
  sampleUrl: string | null
}

// Category buckets, keyed by voice id. Ordering of VOICE_CATALOG below follows
// the backend `_MINIMAX_VOICES` order so the gallery reads the same as the node.
const FEMALE = [
  'Wise_Woman', 'Calm_Woman', 'Lively_Girl', 'Lovely_Girl',
  'Inspirational_girl', 'Sweet_Girl_2', 'Exuberant_Girl',
]
const MALE = [
  'Deep_Voice_Man', 'Casual_Guy', 'Patient_Man', 'Determined_Man',
  'Decent_Boy', 'Imposing_Manner', 'Elegant_Man',
]
const CHARACTER = ['Friendly_Person', 'Young_Knight', 'Abbess']

function categoryOf(id: string): VoiceCategory | null {
  if (FEMALE.includes(id)) return 'Female'
  if (MALE.includes(id)) return 'Male'
  if (CHARACTER.includes(id)) return 'Character'
  return null
}

/** "Inspirational_girl" → "Inspirational Girl", "Sweet_Girl_2" → "Sweet Girl 2". */
function humanize(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function sampleUrlFor(id: string): string {
  return `/voice-samples/${id}.mp3`
}

// Catalog order mirrors backend _MINIMAX_VOICES.
const VOICE_IDS = [
  'Wise_Woman', 'Friendly_Person', 'Inspirational_girl', 'Deep_Voice_Man',
  'Calm_Woman', 'Casual_Guy', 'Lively_Girl', 'Patient_Man', 'Young_Knight',
  'Determined_Man', 'Lovely_Girl', 'Decent_Boy', 'Imposing_Manner', 'Elegant_Man',
  'Abbess', 'Sweet_Girl_2', 'Exuberant_Girl',
]

export const VOICE_CATALOG: VoiceMeta[] = VOICE_IDS.map(id => ({
  id,
  label: humanize(id),
  category: categoryOf(id) ?? 'Character',
  sampleUrl: sampleUrlFor(id),
}))

const BY_ID = new Map(VOICE_CATALOG.map(v => [v.id, v]))

/**
 * Metadata for a voice id. Unknown ids (not in the catalog) get a humanized
 * label, the 'Character' catch-all bucket, and no preview.
 */
export function voiceMetaFor(id: string): VoiceMeta {
  return BY_ID.get(id) ?? {
    id,
    label: humanize(id),
    category: 'Character',
    sampleUrl: null,
  }
}

/**
 * Cards to show for a node's combo options: known voices first in catalog order,
 * then any option ids the catalog doesn't recognise as preview-less entries.
 */
export function voicesForOptions(options: string[]): VoiceMeta[] {
  const opt = new Set(options)
  const known = VOICE_CATALOG.filter(v => opt.has(v.id))
  const knownIds = new Set(known.map(v => v.id))
  const unknown = options.filter(id => !knownIds.has(id)).map(voiceMetaFor)
  return [...known, ...unknown]
}
