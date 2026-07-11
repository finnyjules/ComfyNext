// Pure readers for wired Smart Layout sockets on the serialized Vue Flow
// graph — the client-side mirror of what the backend does with real tensors
// at run time. Mirrors SmartLayoutEditorModal's readUpstreamText /
// readUpstreamImageUrl (which also handle multi-entry variants and kv
// parsing; consolidate there when touching that file next).

const MAX_LAYERS = 8

function wiredSource(nodes: any[], edges: any[], nodeId: string, inputName: string): any | null {
  const node = nodes.find((n: any) => String(n.id) === String(nodeId))
  const inputs = node?.data?.inputs as any[] | undefined
  if (!inputs) return null
  const idx = inputs.findIndex((i: any) => i.name === inputName)
  if (idx < 0) return null
  const edge = edges.find((e: any) =>
    String(e.target) === String(nodeId) && e.targetHandle === `input-${idx}`)
  if (!edge) return null
  return nodes.find((n: any) => String(n.id) === String(edge.source)) ?? null
}

/** Wired Text node's widget value, or null when nothing readable is wired. */
export function readWiredText(nodes: any[], edges: any[], nodeId: string, inputName: string): string | null {
  const source = wiredSource(nodes, edges, nodeId, inputName)
  if (!source || source.data?.nodeType !== 'Text') return null
  const defs = source.data.widgetDefs as any[] | undefined
  const wv = source.data.widgetsValues as any[] | undefined
  const textIdx = defs?.findIndex((d: any) => d.name === 'text') ?? -1
  if (textIdx < 0) return null
  const raw = String(wv?.[textIdx] ?? '').trim()
  return raw || null
}

/** Wired image source's preview URL (LoadImage/Image widget filename via
 *  /view, or an executed node's data.images[0]), or null. */
export function readWiredImageUrl(nodes: any[], edges: any[], nodeId: string, inputName: string): string | null {
  const source = wiredSource(nodes, edges, nodeId, inputName)
  if (!source) return null
  if (source.data?.nodeType === 'LoadImage' || source.data?.nodeType === 'Image') {
    const defs = source.data.widgetDefs as any[] | undefined
    const wv = source.data.widgetsValues as any[] | undefined
    const wIdx = defs?.findIndex((d: any) => d.name === 'image') ?? -1
    const filename = wIdx >= 0 ? wv?.[wIdx] : undefined
    if (filename) return `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`
  }
  if (source.data?.images?.length) return String(source.data.images[0])
  return null
}

/** Every readable wired layer value: text_layer_1..8 + image_layer_1..8.
 *  Unwired / unreadable sockets are simply absent. */
export function wiredLayerProps(nodes: any[], edges: any[], nodeId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 1; i <= MAX_LAYERS; i++) {
    const text = readWiredText(nodes, edges, nodeId, `text_layer_${i}`)
    if (text) out[`text_layer_${i}`] = text
    const url = readWiredImageUrl(nodes, edges, nodeId, `image_layer_${i}`)
    if (url) out[`image_layer_${i}`] = url
  }
  return out
}
