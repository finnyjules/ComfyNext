/** Face tables + last-used reducers for the 3D Studio's bottom add-pill.
 *
 *  The pill wears the Frame toolbar's face+caret grammar (see
 *  `lib/compositor/toolbarMenus.ts`, the reference implementation): the face
 *  repeats the last-used entry in one click, the caret opens the full menu.
 *  This module is the scene3d twin of that one — deliberately a SEPARATE file
 *  rather than an extension of it, because these tables need `PrimitiveKind`
 *  and `LIGHT_KINDS` from `lib/scene3d/config`, and dragging scene3d types into
 *  the compositor module would couple two unrelated surfaces.
 *
 *  Only the *lists* and the reducers live here — the handlers stay in the SFC
 *  (they close over the doc), which is what lets the unit suite pin defaults
 *  and last-used behaviour without mounting the studio. */
import type { Component } from 'vue'
import { Type as TypeIcon, Image as ImageIcon } from 'lucide-vue-next'
import { LIGHT_KINDS, type LightKind, type PrimitiveKind } from './config'
import { PRIM_GROUPS, type PrimGroupItem } from './primGroups'

// ── Primitive ───────────────────────────────────────────────────────────────

/** The grouped grid, flattened. The menu keeps its groups; the face only ever
 *  needs a kind → icon/label lookup, and deriving it from PRIM_GROUPS means a
 *  new primitive can never be facable-but-iconless. */
export const PRIM_ITEMS: readonly PrimGroupItem[] = PRIM_GROUPS.flatMap(g => g.kinds)

/** The face a freshly-opened studio wears. Box is the first row of the first
 *  group — the same "first entry is the default" rule as the Frame toolbar. */
export const DEFAULT_PRIM_FACE: PrimitiveKind = 'box'

/** Last-used-face reducer: anything unknown (a stale value, a kind that left
 *  the menu) falls back to the default, so the face can never end up without an
 *  icon or without a handler. */
export function resolvePrimFace(kind: string | null | undefined): PrimitiveKind {
  return PRIM_ITEMS.some(p => p.kind === kind) ? kind as PrimitiveKind : DEFAULT_PRIM_FACE
}

export function primFaceLabel(kind: string | null | undefined): string {
  const face = resolvePrimFace(kind)
  return PRIM_ITEMS.find(p => p.kind === face)!.label
}

export function primFaceIcon(kind: string | null | undefined): Component {
  const face = resolvePrimFace(kind)
  return PRIM_ITEMS.find(p => p.kind === face)!.icon
}

// ── Light ───────────────────────────────────────────────────────────────────

/** Menu row text. Lived in the SFC until the face needed it too. */
export const LIGHT_KIND_LABELS: Record<LightKind, string> = { point: 'Point', spot: 'Spot', rect: 'Area' }

/** Default face = the first of LIGHT_KINDS (spec), read from the list rather
 *  than hardcoded so reordering the kinds moves the default with them. */
export const DEFAULT_LIGHT_FACE: LightKind = LIGHT_KINDS[0]!

export function resolveLightFace(kind: string | null | undefined): LightKind {
  return LIGHT_KINDS.some(k => k === kind) ? kind as LightKind : DEFAULT_LIGHT_FACE
}

export function lightFaceLabel(kind: string | null | undefined): string {
  return LIGHT_KIND_LABELS[resolveLightFace(kind)]
}

// ── Decal ───────────────────────────────────────────────────────────────────

export type DecalEntryId = 'text' | 'image'

export interface DecalEntryRow {
  id: DecalEntryId
  label: string
  icon: Component
}

/** Menu order, top to bottom. Both entries ARM a viewport placement rather than
 *  adding an object — re-running one from the face re-arms the same placement,
 *  which is what "repeat the last-used entry" means for a decal. */
export const DECAL_ENTRIES: readonly DecalEntryRow[] = [
  { id: 'text', label: 'Text label', icon: TypeIcon },
  { id: 'image', label: 'Image sticker', icon: ImageIcon },
]

/** Text label first: it is the default face. */
export const DEFAULT_DECAL_FACE: DecalEntryId = 'text'

export function resolveDecalFace(id: string | null | undefined): DecalEntryId {
  return DECAL_ENTRIES.some(r => r.id === id) ? id as DecalEntryId : DEFAULT_DECAL_FACE
}

export function decalFaceLabel(id: string | null | undefined): string {
  const face = resolveDecalFace(id)
  return DECAL_ENTRIES.find(r => r.id === face)!.label
}

export function decalFaceIcon(id: string | null | undefined): Component {
  const face = resolveDecalFace(id)
  return DECAL_ENTRIES.find(r => r.id === face)!.icon
}
