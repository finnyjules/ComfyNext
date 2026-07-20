// frontend/app/lib/studio/frameResolve.ts
// The single studio-aware resolver for a wired input. Given a target node + handle,
// returns a live studio frame source (preferred) or a baked image URL — folding in
// the Frame's multi-output/LoadImage/Image cases so it can replace resolveSrcUrl,
// getUpstreamImageUrl, getNodeImageUrl AND the shader's resolveSourceKind.

import { getStudioFrameSource, type StudioFrameSource } from '~/lib/studio/frameSource'

export type WiredSourceKind =
  | { kind: 'live'; source: StudioFrameSource }
  | { kind: 'url'; url: string }
  | null

/** Read an upstream node's widget value by name (widgetDefs[i] ↔ widgetsValues[i]). */
function widgetVal(src: any, name: string): string | null {
  const defs = src?.data?.widgetDefs
  const vals = src?.data?.widgetsValues
  if (!Array.isArray(defs) || !Array.isArray(vals)) return null
  const i = defs.findIndex((w: any) => w?.name === name)
  return i >= 0 ? (vals[i] || null) : null
}

/** Multi-output sources mirror images in output-slot order; the wire picks which. */
function outputIndex(edge: any): number {
  const m = /^output-(\d+)$/.exec(edge?.sourceHandle ?? '')
  return m ? Number(m[1]) : 0
}

function urlFor(src: any, edge: any): string | null {
  if (src?.data?.images?.length) {
    const i = outputIndex(edge)
    return src.data.images[i] ?? src.data.images[0]
  }
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  if (src?.data?.nodeType === 'Image') {
    const file = widgetVal(src, 'image')
    if (file) return `/view?${new URLSearchParams({ filename: file, type: 'input' })}`
  }
  return null
}

/**
 * Resolve whatever is wired into `target`'s `handle`. Live upstream studio wins
 * (renders at any size/time); else a baked URL; else null. Ids are coerced to
 * strings so numeric litegraph ids and string vue-flow ids both match.
 */
export function resolveWiredSourceKind(
  target: string, handle: string, nodes: any[], edges: any[],
): WiredSourceKind {
  const edge = edges.find((e: any) => String(e.target) === String(target) && e.targetHandle === handle)
  if (!edge) return null
  const live = getStudioFrameSource(String(edge.source))
  if (live) return { kind: 'live', source: live }
  const src = nodes.find((n: any) => String(n.id) === String(edge.source))
  const url = src ? urlFor(src, edge) : null
  return url ? { kind: 'url', url } : null
}
