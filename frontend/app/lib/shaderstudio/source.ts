// frontend/app/lib/shaderstudio/source.ts
// Resolve the image feeding a Shader Studio node's input-0 handle. Mirrors the
// resolveSrcUrl logic in app/lib/shaderfx/chain.ts (kept local so the studio engine
// is self-contained).

// Read a node's widget value by name (widgetDefs[i] ↔ widgetsValues[i]).
function widgetValue(src: any, name: string): string | null {
  const defs = src?.data?.widgetDefs
  const vals = src?.data?.widgetsValues
  if (!Array.isArray(defs) || !Array.isArray(vals)) return null
  const i = defs.findIndex((w: any) => w?.name === name)
  return i >= 0 ? (vals[i] || null) : null
}

function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  // An `Image` artifact node (a pasted or uploaded image) before it has executed:
  // its filename lives in the `image` widget (resolved by name), and data.images
  // is still empty. Mirror ArtifactImageNode's own /view resolution.
  if (src?.data?.nodeType === 'Image') {
    const file = widgetValue(src, 'image')
    if (file) return `/view?${new URLSearchParams({ filename: file, type: 'input' })}`
  }
  return null
}

export function resolveWiredInput(nodeId: string, nodes: any[], edges: any[]): string | null {
  // Coerce ids — edges/nodes carry numeric ids from a saved/litegraph graph but
  // string ids when freshly created, so strict === could miss the match.
  const e = edges.find((e: any) => String(e.target) === String(nodeId) && e.targetHandle === 'input-0')
  if (!e) return null
  const src = nodes.find((n: any) => String(n.id) === String(e.source))
  return src ? resolveSrcUrl(src) : null
}

/** Load an image URL into an HTMLImageElement (CORS-enabled for /view assets). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
