/**
 * Applying a moodboard to the Generate-an-image node (moodboards Plan B,
 * Task B2). A moodboard pick on GenerateImageNode is WEIGHTLESS — no LoRA
 * loads — so the whole apply is two node properties:
 *
 *   aesthetic        — the composed style block (moodboardStyleBlock over the
 *                      board's Fable reading). composeLoraStyle reads it at
 *                      submit time and the injector writes it into the node's
 *                      hidden `style_block` widget by NAME (see styleInject.ts).
 *   sailor_moodboard — the board's identity, so the chip on the node face can
 *                      show name + thumb and the ✕ knows what to clear.
 *
 * Pure property writes, no DOM/canvas dependency — used by the chip picker
 * now and by Task B4's TASTE-wire materialization later.
 */
import { moodboardStyleBlock } from '~/lib/taste/styleBlock'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

export interface MoodboardApplyWrites {
  aesthetic: string
  sailor_moodboard: string
}

/** Minimal node-data shape the apply touches — keeps the helper testable. */
export interface MoodboardApplyTarget {
  properties?: Record<string, any>
}

/**
 * Write the moodboard's style block + identity onto the node. Creates the
 * `properties` bag when missing. Returns the writes it performed so callers
 * (and tests) can assert on them without re-deriving the block.
 */
export function applyMoodboardToGenerateNode(
  nodeData: MoodboardApplyTarget,
  entry: MoodboardEntry,
): MoodboardApplyWrites {
  const writes: MoodboardApplyWrites = {
    aesthetic: moodboardStyleBlock(entry.reading),
    sailor_moodboard: entry.id,
  }
  if (!nodeData.properties) nodeData.properties = {}
  nodeData.properties.aesthetic = writes.aesthetic
  nodeData.properties.sailor_moodboard = writes.sailor_moodboard
  return writes
}

/**
 * The chip's ✕ — removes both the style block and the identity key, so the
 * node stops steering the prompt AND stops reading as moodboard-filled.
 */
export function clearMoodboardFromGenerateNode(nodeData: MoodboardApplyTarget): void {
  if (!nodeData.properties) return
  delete nodeData.properties.aesthetic
  delete nodeData.properties.sailor_moodboard
}
