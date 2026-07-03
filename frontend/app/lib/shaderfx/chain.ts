import { parseParams } from './params'

export interface ChainPass {
  effectId: string
  params: Record<string, number>
  seed: number
}

export interface ChainResult {
  /** Render order: most-upstream first. Always includes the node itself (last). */
  passes: ChainPass[]
  /** Image to feed pass 0, or null (placeholder). */
  baseUrl: string | null
  /** Upstream node ids visited (for downstream-refresh checks). */
  nodeIds: string[]
}

function widgetVal(n: any, name: string): any {
  const i = n?.data?.widgetDefs?.findIndex((w: any) => w.name === name) ?? -1
  return i >= 0 ? n.data.widgetsValues?.[i] : undefined
}

function passOf(n: any): ChainPass {
  return {
    effectId: String(widgetVal(n, 'effect') ?? ''),
    params: parseParams(String(widgetVal(n, 'params') ?? '{}')),
    seed: Number(widgetVal(n, 'seed') ?? 42),
  }
}

/** Same image-URL resolution as ArtifactFrameNode.resolveSrcUrl. */
function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  // An `Image` artifact node (pasted/uploaded image) before it has executed: its
  // filename lives in the `image` widget (by name), with data.images still empty.
  if (src?.data?.nodeType === 'Image') {
    const file = widgetVal(src, 'image')
    if (file) return `/view?${new URLSearchParams({ filename: String(file), type: 'input' })}`
  }
  return null
}

export function walkShaderChain(nodeId: string, nodes: any[], edges: any[], maxDepth = 8): ChainResult {
  const byId = new Map(nodes.map((n: any) => [n.id, n]))
  const self = byId.get(nodeId)
  const passes: ChainPass[] = self ? [passOf(self)] : []
  const nodeIds: string[] = []
  let baseUrl: string | null = null
  const seen = new Set<string>([nodeId])

  let current = nodeId
  for (let depth = 0; depth < maxDepth; depth++) {
    const e = edges.find((e: any) => e.target === current && e.targetHandle === 'input-0')
    if (!e) break
    const src = byId.get(e.source)
    if (!src || seen.has(src.id)) break
    seen.add(src.id)
    nodeIds.push(src.id)
    const executed = !!src.data?.images?.length
    if (src.data?.nodeType === 'ShaderEffect' && !executed) {
      passes.unshift(passOf(src))
      current = src.id
      continue
    }
    baseUrl = resolveSrcUrl(src)
    break
  }
  return { passes, baseUrl, nodeIds }
}
