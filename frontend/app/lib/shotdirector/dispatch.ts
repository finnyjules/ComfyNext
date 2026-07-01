/**
 * Pure mapping from a compiled ShotSheet to the FilmShotNode widget patch that
 * dispatches it, plus target-node discovery. The FilmShotNode's own widgets
 * carry prompt/model/aspect_ratio/duration/seed; everything else the Seedance
 * builder needs (resolution, references, first/last frame, generate_audio)
 * rides in the model_options JSON, which reaches the Python builder as `adv`.
 */
import type { CompileResult } from '~/lib/shotdirector/compile'
import type { ShotSheet } from '~/lib/shotdirector/types'

export interface FilmShotWidgetPatch {
  prompt: string
  model: string
  aspect_ratio: string
  duration: number
  seed: number
  model_options: string
}

/** Keys of the compiled Replicate input that map to FilmShotNode widgets —
 *  everything else goes into model_options. */
const WIDGET_NATIVE = new Set(['prompt', 'duration', 'aspect_ratio', 'seed'])

export function buildFilmShotPatch(sheet: ShotSheet, result: CompileResult): FilmShotWidgetPatch {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.input)) {
    if (!WIDGET_NATIVE.has(key)) extras[key] = value
  }
  return {
    prompt: result.prompt,
    model: 'seedance-2.0',
    // In firstLastFrame mode the compiled input has no aspect_ratio (image
    // dims win); send the sheet's anyway — the builder ignores it then.
    aspect_ratio: sheet.format.aspectRatio,
    duration: sheet.format.durationS,
    seed: sheet.format.seed && sheet.format.seed > 0 ? sheet.format.seed : 0,
    model_options: JSON.stringify(extras),
  }
}

export interface TargetNode { id: string, nodeType?: string }
export interface TargetEdge { source: string, target: string }

/** The FilmShotNode a Shot Director drives: the remembered target if it still
 *  exists, else the first FilmShotNode reachable downstream, else null. */
export function findShotTarget(
  nodes: TargetNode[],
  edges: TargetEdge[],
  studioId: string,
  storedTargetId?: string | null,
): string | null {
  if (storedTargetId && nodes.some(n => n.id === storedTargetId && n.nodeType === 'FilmShotNode')) {
    return storedTargetId
  }
  const byId = new Map(nodes.map(n => [n.id, n]))
  const queue = [studioId]
  const seen = new Set<string>(queue)
  while (queue.length) {
    const cur = queue.shift()!
    for (const e of edges) {
      if (e.source !== cur || seen.has(e.target)) continue
      seen.add(e.target)
      if (byId.get(e.target)?.nodeType === 'FilmShotNode') return e.target
      queue.push(e.target)
    }
  }
  return null
}
