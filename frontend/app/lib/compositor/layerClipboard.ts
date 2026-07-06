/**
 * In-app clipboard for the Compositor / Frame editor. Pure copy/paste transforms
 * (mirroring layerEdits.duplicateLayers) plus a module-level singleton so paste
 * works ACROSS frame modals within a session. Deep-clones via JSON round-trip —
 * LocalLayer is plain data (see layerEdits duplicateLayers).
 */
import type { LocalLayer } from '~/composables/useCompositorLayers'
import type { LayerGroup } from '~/lib/compositor/layerGroups'

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)) }

export interface ClipboardPayload { layers: LocalLayer[]; groups: LayerGroup[] }

/** Deep-clone the selected layers + the group registry entries they reference. */
export function extractForCopy(layers: LocalLayer[], groups: LayerGroup[], selectedIds: Set<string>): ClipboardPayload | null {
  const sel = layers.filter(l => selectedIds.has(l.id))
  if (!sel.length) return null
  const gids = new Set(sel.map(l => l.groupId).filter(Boolean) as string[])
  return {
    layers: JSON.parse(JSON.stringify(sel)) as LocalLayer[],
    groups: JSON.parse(JSON.stringify(groups.filter(g => gids.has(g.id)))) as LayerGroup[],
  }
}

/** Paste a payload into an existing layer set: fresh ids, one new group id per
 *  distinct source group (carrying its name), offset applied, appended on top. */
export function materializePaste(
  payload: ClipboardPayload,
  layers: LocalLayer[],
  groups: LayerGroup[],
  offset: number,
  mkId: () => string,
  mkGid: () => string,
): { layers: LocalLayer[]; groups: LayerGroup[]; newIds: string[] } {
  const groupMap = new Map<string, string>()
  const newIds: string[] = []
  const clones = payload.layers.map((l) => {
    const c = JSON.parse(JSON.stringify(l)) as any
    c.id = mkId(); newIds.push(c.id)
    c.x = clamp(l.x + offset, -0.5, 1.5)
    c.y = clamp(l.y + offset, -0.5, 1.5)
    if (l.groupId) {
      if (!groupMap.has(l.groupId)) groupMap.set(l.groupId, mkGid())
      c.groupId = groupMap.get(l.groupId)
    }
    return c as LocalLayer
  })
  const newGroups: LayerGroup[] = [...groups]
  for (const [src, nid] of groupMap) {
    const srcG = payload.groups.find(g => g.id === src)
    newGroups.push(srcG?.name ? { id: nid, name: srcG.name } : { id: nid })
  }
  return { layers: [...layers, ...clones], groups: newGroups, newIds }
}

// Shared in-app clipboard (module singleton → cross-frame within a session).
let _clip: ClipboardPayload | null = null
export function setClipboard(p: ClipboardPayload | null): void { _clip = p }
export function getClipboard(): ClipboardPayload | null { return _clip }
export function hasClipboard(): boolean { return !!_clip && _clip.layers.length > 0 }
export function _resetClipboard(): void { _clip = null }
