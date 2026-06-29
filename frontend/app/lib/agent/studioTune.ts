/**
 * studioTune — let the CANVAS agent drive a STUDIO node's OWN surface, headlessly.
 *
 * Slice 1: the Frame (Compositor). A Frame's whole state lives on the node as
 * `data.properties.comfynext_localLayers` + `comfynext_localBg`, and the Frame node
 * re-bakes its thumbnail reactively from those — so we can read the CompositorState
 * off the node, plan against the Compositor surface (the same one the in-modal agent
 * uses), apply the result back onto the node, and the frame updates in place. No
 * modal, no re-implementation of rendering.
 *
 * Returns row summaries for the proposal + an undo closure (Dismiss restores the
 * node's prior state). Media ops (generate/edit/remove-bg inside the frame) need the
 * modal's upload+canvas tooling and are skipped here with a notice.
 */
import { $fetch } from 'ofetch'
import { applyCompositorCommand, describeCompositor, summarizeCompositorChange, type CompositorState } from '~/lib/agent/surfaces/compositor'
import { buildAgentPrompt, buildCommandSchema, parseAgentResponse } from '~/lib/agent/protocol'

const MEDIA_OPS = new Set(['generateImage', 'editImage', 'removeImageBackground'])

export interface TuneRow { label: string; before: string; after: string; rationale: string }
export interface TuneResult { ok: boolean; rows: TuneRow[]; restore: () => void; notice?: string; error?: string }

/** Read a Frame node's CompositorState from its persisted properties (deep-cloned
 *  so the live node isn't mutated until we write back). */
function readState(node: any): CompositorState {
  const props = node?.data?.properties ?? {}
  return {
    layers: JSON.parse(JSON.stringify(props.comfynext_localLayers ?? [])),
    background: props.comfynext_localBg,
  }
}
/** Write a CompositorState back onto the node — mirrors useLocalLayerEditor's
 *  commit/writeBg so the Frame re-bakes (and persists) exactly as a hand-edit would. */
function writeState(node: any, s: CompositorState) {
  if (!node.data.properties) node.data.properties = {}
  node.data.properties.comfynext_localLayers = s.layers
  const bg = s.background
  if (bg === undefined || bg === 'none' || bg === '') delete node.data.properties.comfynext_localBg
  else node.data.properties.comfynext_localBg = bg
}

/** Plan + apply a natural-language tweak to a Frame (Compositor) node in place. */
export async function tuneCompositorNode(node: any, request: string, apiKey: string, tier = 'plan'): Promise<TuneResult> {
  const prior = readState(node)
  const restore = () => writeState(node, prior)
  let state = readState(node)
  const snapshot = describeCompositor(state)
  const res = await $fetch<{ text: string }>('/api/agent-plan', {
    method: 'POST',
    body: { apiKey, tier, prompt: buildAgentPrompt(snapshot, request), schema: buildCommandSchema(snapshot.commands) },
    timeout: 60_000,
  })
  const { commands, changeRationales, message } = parseAgentResponse(res.text)
  const rows: TuneRow[] = []
  let droppedMedia = false
  commands.forEach((cmd, i) => {
    if (MEDIA_OPS.has(cmd.op)) { droppedMedia = true; return }
    const test = applyCompositorCommand(state, cmd)
    if (!test.ok) return
    const sum = summarizeCompositorChange(state, cmd) ?? { label: cmd.op, before: '', after: '' }
    rows.push({ ...sum, rationale: changeRationales[i] ?? '' })
    state = test.template
  })
  if (rows.length) writeState(node, state) // apply as preview — the frame re-bakes
  const notice = droppedMedia
    ? 'Generating or editing images inside a frame isn’t available from the canvas yet — open the frame to do that.'
    : (rows.length ? undefined : (message || undefined))
  return { ok: rows.length > 0, rows, restore, notice }
}
