// Single source of truth for resolving a Timeline clip's upstream node to a
// playable media source. Every timeline surface (the editor modal, the inline
// node preview, the crossfade modal, the alternate timeline modal) used to carry
// its own near-identical copy of this logic — which is why support for new node
// types (e.g. the universal `Video` artifact) had to be added in N places and
// kept silently breaking previews when one was missed. They now all call this.
//
// Surfaces with a *different* output shape stay separate on purpose:
//   - the export/render path needs raw filenames, not /view URLs
//   - the change-detection snapshot needs a string key
//   - the baked poster wants a mid-sequence still, not a playable sequence

export interface ClipSource {
  /** Single source URL (video/image). For 'sequence' this is the first frame. */
  url: string
  kind: 'video' | 'image' | 'sequence'
  /** For 'sequence': the ordered list of frame URLs to play through. */
  urls?: string[]
}

export interface ResolveClipSourceOpts {
  /**
   * Baked frame-sequence resolution (a Vector Type node carrying frames baked by
   * the retired KineticType node it was migrated from):
   *  - 'sequence' (default): return every rendered frame so playback animates
   *    through them (frame 0 of a fade-in is invisible, so a single still looks
   *    blank).
   *  - 'mid': return a single guaranteed-visible mid-sequence frame, for a
   *    static poster thumbnail.
   */
  kinetic?: 'sequence' | 'mid'
  /**
   * When true (default), any node that has published `data.images` resolves to
   * its first image as a generic fallback (honoring the `animated` flag so video
   * outputs render as video). Set false to restrict resolution to explicitly
   * handled node types (e.g. the baked poster, which should not try to render
   * arbitrary upstream nodes).
   */
  imagesFallback?: boolean
}

function viewUrl(filename: string): string {
  return `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`
}

/**
 * Read a widget value by name from a node's data.
 * @param fallbackZero  mirror the legacy Load* behavior of falling back to
 *   widget index 0 when the named widget isn't found. Artifact nodes pass false
 *   so a missing 'file' never accidentally grabs an unrelated widget (e.g. the
 *   `export` boolean) as a filename.
 */
function readWidget(data: any, name: string, fallbackZero: boolean): any {
  const defs = data?.widgetDefs as any[] | undefined
  const i = defs ? defs.findIndex((d: any) => d?.name === name) : -1
  if (i >= 0) return data?.widgetsValues?.[i]
  return fallbackZero ? data?.widgetsValues?.[0] : undefined
}

/**
 * Resolve an upstream source node (the node feeding a Timeline clip port) to a
 * playable media source, or null if nothing is resolvable yet (e.g. wired to a
 * processing node that hasn't been run).
 */
export function resolveClipSource(src: any, opts: ResolveClipSourceOpts = {}): ClipSource | null {
  const data = src?.data
  if (!data) return null
  const type = String(data.nodeType ?? '')
  const imagesFallback = opts.imagesFallback !== false

  if (type === 'LoadVideo' || type === 'LoadVideoFrames') {
    const fname = readWidget(data, 'file', true)
    if (fname) return { url: viewUrl(fname), kind: 'video' }
  }

  if (type === 'LoadImage') {
    const fname = readWidget(data, 'image', true)
    if (fname) return { url: viewUrl(fname), kind: 'image' }
  }

  // Sailor universal artifact nodes (Video / Image): a published preview in
  // data.images[0], else the upload widget ('file' for Video, 'image' for
  // Image). Resolved the same way the artifact cards resolve their own source.
  if (type === 'Video' || type === 'Image') {
    const kind: 'video' | 'image' = type === 'Video' ? 'video' : 'image'
    if (data.images?.length) return { url: String(data.images[0]), kind }
    const fname = readWidget(data, type === 'Video' ? 'file' : 'image', false)
    if (fname) return { url: viewUrl(fname), kind }
    return null
  }

  // A Vector Type node migrated from the retired KineticType keeps that node's
  // baked PNG sequence in `sailor_kineticLegacy.frames` (see
  // app/lib/vectortype/migrateKinetic.ts). Those files are still on disk and are
  // still what a saved clip plays, so they resolve exactly as they used to —
  // dropping them would blank every migrated clip. Vector Type nodes that were
  // never a KineticType have no frames here and fall through to `data.images`.
  if (type === 'VectorType') {
    const frames = (data?.properties?.sailor_kineticLegacy as any)?.frames
    if (Array.isArray(frames) && frames.length > 0) {
      if (opts.kinetic === 'mid') {
        return { url: viewUrl(frames[Math.floor(frames.length / 2)]), kind: 'image' }
      }
      const urls = frames.map((fn: string) => viewUrl(fn))
      return { url: urls[0]!, kind: 'sequence', urls }
    }
  }

  // Fallback: any node that has published a preview (e.g. a processed output).
  // Honor `animated` so video outputs render as video, not a static (blank) img.
  if (imagesFallback && data.images?.length) {
    return { url: String(data.images[0]), kind: data.animated ? 'video' : 'image' }
  }

  return null
}
