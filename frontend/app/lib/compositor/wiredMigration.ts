/**
 * Frame schema 2 — one-way migration from the legacy per-slot wired state to
 * unified `wired` LAYERS.
 *
 * Before: a connected input slot was drawn from five `layer{N}_*` widgets plus a
 * scatter of parallel registries on `node.data.properties`
 * (`sailor_hiddenWired`, `sailor_lockedWired`, `sailor_wiredCloners`,
 * `sailor_wiredNames`, `sailor_wiredTreatments`), and it took part in the
 * z-order under a `w:<slot>` key. After: each connected slot is ONE
 * `WiredLayer` inside `sailor_localLayers`, ordered by an ordinary `l:<id>` key,
 * carrying its own visibility, lock, name, cloner and mask reference like every
 * other layer. The wire becomes a pure content feed.
 *
 * Two numbering systems meet here, so they are spelled out once:
 *
 *   - `WiredLayer.slot` is the 0-BASED input-port index (`input-0`, `input-1`,
 *     …). That is what `ArtifactFrameNode`'s internal wired layer uses and what
 *     the write-through in `wiredLayer.ts` turns into `layer{slot + 1}_*`.
 *   - EVERY persisted registry is 1-BASED, matching the backend's `layer1…16`:
 *     `w:1` stack keys, `sailor_hiddenWired: [1]`, `sailor_wiredCloners[1]`,
 *     `sailor_wiredNames[1]`, `sailor_wiredTreatments['w:1']`.
 *
 * So slot 0 reads registry index 1 throughout. `connectedSlots` and the
 * `naturalDims` keys this module takes are 0-based, like `WiredLayer.slot`.
 *
 * The module is pure: no Vue, no DOM, no edge inspection. The caller supplies
 * the connected slot list (it is the one that can see the graph's edges) and
 * whatever content dimensions it has decoded so far, which keeps migration
 * synchronous and unit-testable.
 *
 * Rollback safety: the legacy registries and the `layer{N}_*` widgets are left
 * exactly as they were. Schema-2 hosts must simply stop READING the registries
 * (the widgets stay live — the Python Compositor node still renders from them).
 */

import type { LocalLayer, WiredLayer } from '~/composables/useCompositorLayers'
import { createWiredLayer, wiredBoxFromWidgets, type ContentDims } from '~/lib/compositor/wiredLayer'
import { widgetNum, widgetStr, type WidgetHostData } from '~/lib/compositor/nodeWidgets'

/** `properties.sailor_frameSchema` value meaning "wired slots are layers". */
export const FRAME_SCHEMA_UNIFIED = 2

/**
 * `w` for a wired layer migrated before its content size was known. The first
 * paint that resolves real content finalizes it through `wiredBoxFromWidgets`
 * and persists — a negative width can never be mistaken for a real one. The
 * `layer.w <= 0` guards in `useCompositorLayers.ts`'s wired draw branch and
 * `localLayerBox` are what actually make that true: they skip `drawImage`
 * entirely (a negative width there flips the image instead of skipping it)
 * and report a zero-size box, so a sentinel layer paints and measures as
 * nothing until it resolves.
 */
export const UNRESOLVED_WIRED_W = -1

/**
 * The minimum shape migration needs. Callers pass their live Vue Flow node's
 * `data` by reference plus the connected slots they derived from the graph:
 *
 * ```ts
 * migrateFrameToUnifiedLayers({ data: node.data, connectedSlots }, naturalDims)
 * ```
 *
 * Mutations land on `data.properties`, which is the same object the caller
 * holds, so passing a fresh wrapper costs nothing.
 */
export interface FrameNodeShape {
  /** 0-based input-port indices that currently have an edge. */
  connectedSlots: number[]
  data?: WidgetHostData & { properties?: Record<string, any> }
}

/** Content pixel dimensions per 0-based slot; a missing entry means "unknown". */
export type SlotDims = Record<number, ContentDims | undefined>

/** The artboard fallback when a frame has no explicit size and no known slot. */
const FALLBACK_CANVAS: ContentDims = { w: 1024, h: 1024 }

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }

/** The artboard the legacy contain-fit was computed against. Explicit W/H wins;
 *  otherwise the frame took the BOTTOM (lowest connected) slot's aspect ONLY —
 *  see `baseAspect` in CompositorModal.vue and `aspect` in ArtifactFrameNode.vue,
 *  neither of which ever falls through to a higher slot. Borrowing a different
 *  slot's aspect here would freeze every unresolved layer at the wrong width, so
 *  when the bottom slot's dims aren't known yet this returns `null` and the
 *  caller sentinels everything instead of guessing. */
function canvasDims(
  data: NonNullable<FrameNodeShape['data']>, slots: number[], dims: SlotDims,
): ContentDims | null {
  const w = widgetNum(data, 'width'), h = widgetNum(data, 'height')
  if (w > 0 && h > 0) return { w, h }
  const base = slots[0]
  const d = base !== undefined ? dims[base] : undefined
  if (d && d.w > 0 && d.h > 0) return d
  if (slots.length === 0) return FALLBACK_CANVAS
  return null
}

/**
 * Fold every legacy per-slot registry into `wired` layers. Returns true when it
 * migrated, false when the frame is already schema 2 (or carries no node data),
 * so callers can run it unconditionally on open/mount.
 *
 * NOT migrated, deliberately:
 * - `sailor_wiredTreatments[w:N].maskUrl` — the per-slot raster visibility mask
 *   (Smart Select / brush Mask). No field on the layer model reads it today; it
 *   is consumed only by the legacy wired StackItem draw path in both hosts. It
 *   stays on the registry and schema-2 frames keep reading it BY SLOT until the
 *   modal adoption task gives it a layer-model home.
 * - `sailor_wiredTreatments[w:N].dof` — same reason (paint gates DOF on
 *   `kind === 'image'`).
 * - `layer{N}_protect` — a server-render flag, not a layer property.
 */
export function migrateFrameToUnifiedLayers(node: FrameNodeShape, naturalDims: SlotDims = {}): boolean {
  const data = node?.data
  if (!data) return false
  const props: Record<string, any> = data.properties ?? (data.properties = {})
  if (Number(props.sailor_frameSchema) >= FRAME_SCHEMA_UNIFIED) return false

  const slots = [...new Set(node.connectedSlots ?? [])]
    .filter(s => Number.isInteger(s) && s >= 0)
    .sort((a, b) => a - b)
  const canvas = canvasDims(data, slots, naturalDims)

  const hidden = new Set(((props.sailor_hiddenWired as number[]) ?? []).map(Number))
  const locked = new Set(((props.sailor_lockedWired as number[]) ?? []).map(Number))
  const cloners = (props.sailor_wiredCloners ?? {}) as Record<string, any>
  const names = (props.sailor_wiredNames ?? {}) as Record<string, string>
  const treatments = (props.sailor_wiredTreatments ?? {}) as Record<string, any>

  // Pass 1 — mint a layer per connected slot, and record w:N → l:id so refs
  // between slots can be repointed once every id exists.
  const keyMap = new Map<string, string>()
  const wired: WiredLayer[] = []
  for (const slot of slots) {
    const n = slot + 1                       // registry / widget numbering
    const tf = {
      x: widgetNum(data, `layer${n}_x`),
      y: widgetNum(data, `layer${n}_y`),
      rotation: widgetNum(data, `layer${n}_rotation`),
      scale: widgetNum(data, `layer${n}_scale`, 1) || 1,
      opacity: clamp01(widgetNum(data, `layer${n}_opacity`, 1)),
    }
    const natural = naturalDims[slot]
    // Known content size AND a known artboard ⇒ the exact legacy contain-fit box.
    // Either unknown ⇒ keep the placement the widgets DO pin down and leave the
    // width for first paint (sentinel) — an unknown artboard sentinels EVERY slot,
    // not just the ones missing their own dims, since the contain-fit math needs
    // the artboard to mean anything.
    const box = canvas && natural && natural.w > 0 && natural.h > 0
      ? wiredBoxFromWidgets(tf, natural, canvas)
      : null

    const blend = widgetStr(data, `layer${n}_blend`, 'normal')
    const treatment = treatments[`w:${n}`] ?? {}
    const name = typeof names[n] === 'string' ? names[n].trim() : ''

    const layer = createWiredLayer(slot, {
      x: box ? box.x : 0.5 + tf.x,
      y: box ? box.y : 0.5 + tf.y,
      rotation: tf.rotation,
      opacity: tf.opacity,
      w: box ? box.w : UNRESOLVED_WIRED_W,
      lastAspect: box ? box.lastAspect : 1,
      ...(blend && blend !== 'normal' ? { blend } : {}),
      ...(hidden.has(n) ? { visible: false } : {}),
      ...(locked.has(n) ? { locked: true } : {}),
      ...(cloners[n] ? { cloner: { ...cloners[n] } } : {}),
      ...(name ? { name } : {}),
      ...(treatment.maskedByKey ? { maskedByKey: String(treatment.maskedByKey) } : {}),
      ...(treatment.showSource ? { maskShowSource: true } : {}),
    })
    keyMap.set(`w:${n}`, `l:${layer.id}`)
    wired.push(layer)
  }

  // Pass 2 — repoint every `w:N` reference at the layer that replaced it.
  const remap = (key: string | undefined): string | undefined =>
    (key && keyMap.get(key)) || key
  for (const l of wired) if (l.maskedByKey) l.maskedByKey = remap(l.maskedByKey)

  const locals = (props.sailor_localLayers as LocalLayer[] | undefined) ?? []
  const rewrittenLocals = locals.map((l) => {
    const next = remap((l as any)?.maskedByKey)
    return next && next !== (l as any).maskedByKey ? { ...l, maskedByKey: next } : l
  })

  // Wired layers go UNDER the native ones — the order the editor had before
  // unification, and the seed order for any frame with no saved stack.
  if (wired.length) props.sailor_localLayers = [...wired, ...rewrittenLocals]
  else if (rewrittenLocals.some((l, i) => l !== locals[i])) props.sailor_localLayers = rewrittenLocals

  // `w:N` keys are replaced IN PLACE so depth is preserved exactly. Keys for
  // slots that are no longer connected are left alone; stack reconciliation
  // already drops keys with nothing present behind them.
  const order = props.sailor_stackOrder as string[] | undefined
  if (Array.isArray(order) && order.length) props.sailor_stackOrder = order.map(k => remap(k) ?? k)

  props.sailor_frameSchema = FRAME_SCHEMA_UNIFIED
  return true
}
