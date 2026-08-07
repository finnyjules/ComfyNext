/**
 * Applying a moodboard to the Generate-an-image node (moodboards Plan B,
 * Tasks B2+B3). A moodboard pick on GenerateImageNode is WEIGHTLESS — no LoRA
 * loads — so the whole apply is node properties:
 *
 *   aesthetic        — the composed style block (moodboardStyleBlock over the
 *                      board's Fable reading). composeLoraStyle reads it at
 *                      submit time and the injector writes it into the node's
 *                      hidden `style_block` widget by NAME (see styleInject.ts).
 *   sailor_moodboard — the board's identity, so the chip on the node face can
 *                      show name + thumb and the ✕ knows what to clear.
 *   style_refs       — Task B3: `{folder, files[]}` JSON (input-dir-relative
 *                      paths, ≤3 files, never base64) when the model can take
 *                      reference images (the catalog's 'multi-image' tag);
 *                      EMPTY STRING otherwise. styleInject writes it into the
 *                      hidden `style_refs` widget by name at submit time; the
 *                      Python node reads the files and hands data URLs to the
 *                      ref-capable builder.
 *   sailor_moodboard_switched — Task B3's auto-switch marker: when the node's
 *                      current model can't take refs, the apply flips the model
 *                      widget to MOODBOARD_DEFAULT_MODEL and records the
 *                      PREVIOUS model id here. The chip shows a legible notice
 *                      with a one-click Revert (revertMoodboardSwitch). A
 *                      manual model pick clears the marker (ModelGalleryModal)
 *                      — and an applied board with NO marker means the user
 *                      chose that model on purpose, so re-applying never
 *                      switches over them (manual choice wins).
 *
 * Pure property writes, no DOM/canvas dependency — used by the chip picker
 * now and by Task B4's TASTE-wire materialization later. The model WIDGET
 * write itself stays with the caller (widgets are positional; callers own the
 * widgetDefs lookup) — the helper reports it via `writes.model`.
 */
import { moodboardStyleBlock } from '~/lib/taste/styleBlock'
import { IMAGE_MODELS_BY_ID } from '~/data/image-models'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

/** The model an apply switches to when the current one can't take refs —
 *  Nano Banana Pro, the reference implementation of the refs ride-along. */
export const MOODBOARD_DEFAULT_MODEL = 'nano-banana-pro'

/** Refs cap — mirrored by the Python side (_MOODBOARD_MAX_REFS). */
export const MOODBOARD_MAX_REFS = 3

/** The catalog tag that gates reference images. */
const REF_TAG = 'multi-image'

export interface MoodboardApplyWrites {
  aesthetic: string
  sailor_moodboard: string
  /** `{folder, files[]}` JSON when refs ride along; '' when the (final) model
   *  can't take them or the board has no readable files. */
  style_refs: string
  /** Model id the caller must write into the `model` widget, or null when no
   *  switch happened (already ref-capable, or manual choice wins). */
  model: string | null
  /** The marker value (previous model id) when this apply switched — mirrors
   *  properties.sailor_moodboard_switched. */
  switchedFrom: string | null
}

/** Minimal node-data shape the apply touches — keeps the helper testable. */
export interface MoodboardApplyTarget {
  properties?: Record<string, any>
}

/**
 * Write the moodboard's style block + identity + refs payload onto the node.
 * Creates the `properties` bag when missing. Returns the writes it performed
 * so callers (and tests) can assert on them without re-deriving — and so the
 * caller can perform the positional `model` widget write when it switched.
 *
 * `files` is the board's image file list (the guarded list route's `files`,
 * already sorted); `modelId`/`modelTags` describe the node's CURRENT model.
 */
export function applyMoodboardToGenerateNode(
  nodeData: MoodboardApplyTarget,
  entry: MoodboardEntry,
  files: string[],
  modelId: string,
  modelTags: string[],
): MoodboardApplyWrites {
  if (!nodeData.properties) nodeData.properties = {}
  const props = nodeData.properties

  // Manual choice wins: a board already applied WITHOUT the auto-switch marker
  // means the current model is the user's own pick — never re-switch over it.
  const manualChoice = !!props.sailor_moodboard && !props.sailor_moodboard_switched
  const switching = !modelTags.includes(REF_TAG) && !manualChoice
  // Tags of the model the run will actually use — after a switch, the default
  // model's (from the catalog, so the gate can't drift from the source).
  const finalTags: readonly string[] = switching
    ? (IMAGE_MODELS_BY_ID[MOODBOARD_DEFAULT_MODEL]?.tags ?? [])
    : modelTags

  const refFiles = files.filter(f => typeof f === 'string' && f).slice(0, MOODBOARD_MAX_REFS)
  const styleRefs = finalTags.includes(REF_TAG) && refFiles.length > 0
    ? JSON.stringify({ folder: entry.folder, files: refFiles })
    : ''

  if (switching) {
    // Keep the ORIGINAL pre-switch model if a marker already exists — revert
    // must land on the user's true model, not an intermediate.
    props.sailor_moodboard_switched = String(props.sailor_moodboard_switched || modelId)
  }

  const writes: MoodboardApplyWrites = {
    aesthetic: moodboardStyleBlock(entry.reading),
    sailor_moodboard: entry.id,
    style_refs: styleRefs,
    model: switching ? MOODBOARD_DEFAULT_MODEL : null,
    switchedFrom: switching ? String(props.sailor_moodboard_switched) : null,
  }
  props.aesthetic = writes.aesthetic
  props.sailor_moodboard = writes.sailor_moodboard
  props.style_refs = writes.style_refs
  return writes
}

/**
 * The Moodboard node's own widget sync (Plan B, Task B4). The Python twin
 * (comfy_extras/nodes_moodboard.py) reads two hidden STRING widgets —
 * `reading_json` (the entry's reading as JSON) and `moodboard_id` — and
 * widgets_values is POSITIONAL, so the values are written by NAME against the
 * node's widgetDefs (the /object_info-derived order). When the defs don't
 * carry the name yet (backend not restarted since the twin landed, so
 * objectInfo lacks the Moodboard schema), fall back to the canonical schema
 * order below — it IS the twin's declared order, and the append-only schema
 * contract keeps it stable.
 *
 * Called on modal save AND whenever the node's referenced entry changes
 * (MoodboardNode.vue watches the entry). `entry` null/undefined clears both
 * widgets (reference removed).
 */
export const MOODBOARD_WIDGET_ORDER = ['reading_json', 'moodboard_id'] as const

export interface MoodboardWidgetTarget {
  widgetsValues?: any[]
  widgetDefs?: { name: string }[]
}

export function syncMoodboardWidgets(
  nodeData: MoodboardWidgetTarget,
  entry: Pick<MoodboardEntry, 'id' | 'reading'> | null | undefined,
): void {
  if (!Array.isArray(nodeData.widgetsValues)) nodeData.widgetsValues = []
  const wv = nodeData.widgetsValues
  const defs = Array.isArray(nodeData.widgetDefs) ? nodeData.widgetDefs : []
  const write = (name: (typeof MOODBOARD_WIDGET_ORDER)[number], value: string): void => {
    const defIdx = defs.findIndex(d => d?.name === name)
    const idx = defIdx >= 0 ? defIdx : MOODBOARD_WIDGET_ORDER.indexOf(name)
    while (wv.length <= idx) wv.push('')
    wv[idx] = value
  }
  write('reading_json', entry ? JSON.stringify(entry.reading) : '')
  write('moodboard_id', entry ? entry.id : '')
}

/**
 * The chip's one-click Revert on the auto-switch notice: clears the marker and
 * the refs payload, returns the model id the caller must restore into the
 * `model` widget (null when there is nothing to revert). The board itself
 * stays applied — revert is about the MODEL, not the style block.
 */
export function revertMoodboardSwitch(nodeData: MoodboardApplyTarget): string | null {
  const props = nodeData.properties
  const prev = props?.sailor_moodboard_switched
  if (!props || typeof prev !== 'string' || !prev) return null
  delete props.sailor_moodboard_switched
  delete props.style_refs
  return prev
}

/**
 * The chip's ✕ — removes the style block, the identity key, the refs payload
 * and the switch marker, so the node stops steering the prompt AND stops
 * reading as moodboard-filled. The model widget is left alone (no silent model
 * change on clear — the picker shows what you're on).
 */
export function clearMoodboardFromGenerateNode(nodeData: MoodboardApplyTarget): void {
  if (!nodeData.properties) return
  delete nodeData.properties.aesthetic
  delete nodeData.properties.sailor_moodboard
  delete nodeData.properties.style_refs
  delete nodeData.properties.sailor_moodboard_switched
}
