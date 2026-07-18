/**
 * Collect every media FILENAME referenced by a project — across all of its
 * canvases' serialized workflows plus the live nodes of the open canvas — so
 * the Timeline editor's Project tab can show "media from this project" instead
 * of the whole input/ directory.
 *
 * Sources walked:
 *  • widgets_values (serialized) / data.widgetsValues (live): plain filename
 *    strings ("clip.mp4") and annotated values ("clip.mp4 [input]")
 *  • takes + legacy images/audios/videos arrays: /view?filename=… URLs
 *  • properties.sailor_preview: same URL shapes
 *
 * Pure module — unit-tested in tests/unit/timeline-project-media.unit.spec.ts.
 */

const MEDIA_EXT = /\.(mp4|mov|webm|mxf|m4v|gif|png|jpe?g|webp|avif|mp3|wav|flac|m4a|ogg|aac)$/i

/** "clip.mp4", "clip.mp4 [input]", "sub/clip.mp4" → "clip.mp4"; else null. */
export function mediaFilenameFromValue(v: unknown): string | null {
  if (typeof v !== 'string' || !v || v.length > 500) return null
  // View/API URL: take the filename query param.
  if (v.includes('filename=')) {
    try {
      const f = new URL(v, 'http://x').searchParams.get('filename')
      if (f && MEDIA_EXT.test(f)) return f.split('/').pop()!
    } catch { /* fall through to plain-string handling */ }
  }
  if (v.includes('?') || v.includes('#') || /^https?:/i.test(v) || v.startsWith('data:')) return null
  // Annotated widget value: "name.png [input]" → "name.png".
  const base = v.replace(/\s+\[[a-z]+\]$/i, '')
  if (!MEDIA_EXT.test(base)) return null
  return base.split('/').pop()!
}

function collectFromUnknown(x: unknown, out: Set<string>, depth: number): void {
  if (depth > 4 || x == null) return
  if (typeof x === 'string') {
    const f = mediaFilenameFromValue(x)
    if (f) out.add(f)
    return
  }
  if (Array.isArray(x)) {
    for (const v of x) collectFromUnknown(v, out, depth + 1)
    return
  }
  if (typeof x === 'object') {
    for (const v of Object.values(x as Record<string, unknown>)) collectFromUnknown(v, out, depth + 1)
  }
}

/** Serialized LiteGraph workflow → filenames from its nodes. */
export function collectWorkflowMedia(workflow: any, out: Set<string>): void {
  for (const n of workflow?.nodes ?? []) {
    collectFromUnknown(n?.widgets_values, out, 0)
    collectFromUnknown(n?.properties, out, 0)
  }
}

/** Live Vue Flow nodes (the open canvas — fresher than its serialized twin). */
export function collectLiveNodesMedia(nodes: any[], out: Set<string>): void {
  for (const n of nodes ?? []) {
    const d = n?.data
    if (!d) continue
    collectFromUnknown(d.widgetsValues, out, 0)
    collectFromUnknown(d.properties, out, 0)
    collectFromUnknown(d.images, out, 0)
    collectFromUnknown(d.audios, out, 0)
    collectFromUnknown(d.videos, out, 0)
    for (const t of d.takes ?? []) {
      collectFromUnknown(t?.images, out, 0)
      collectFromUnknown(t?.audios, out, 0)
      collectFromUnknown(t?.videos, out, 0)
    }
  }
}

/** All media filenames referenced anywhere in the project. */
export function collectProjectMediaFilenames(
  projectDoc: { canvases?: { workflow?: any }[] } | null | undefined,
  liveNodes: any[],
): Set<string> {
  const out = new Set<string>()
  for (const c of projectDoc?.canvases ?? []) collectWorkflowMedia(c?.workflow, out)
  collectLiveNodesMedia(liveNodes, out)
  return out
}
