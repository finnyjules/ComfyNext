/**
 * Resolve a canvas node to the URL of the image it is showing.
 *
 * Mirrors ArtifactImageNode's own `imageUrl` rule so the node clipboard, the Compositor
 * and anything else agree on "what image is this node showing" rather than each deriving
 * it slightly differently.
 *
 * Order matters: a rendered execution output wins over the file widget, because once a
 * node has run, the widget still holds the INPUT the run started from.
 */

/** Node types that can be showing an image. */
const IMAGE_NODE_TYPES = new Set(['artifact-image'])

function widgetValueByName(data: any, name: string): string {
  const defs = data?.widgetDefs as any[] | undefined
  const vals = data?.widgetsValues as any[] | undefined
  if (!Array.isArray(vals)) return ''
  if (Array.isArray(defs)) {
    const i = defs.findIndex((d: any) => d?.name === name)
    // widgetsValues is POSITIONAL — matching by name avoids grabbing a seed or a prompt
    // from index 0 on nodes whose image widget sits further down.
    if (i >= 0) return String(vals[i] ?? '')
  }
  return String(vals[0] ?? '')
}

export function imageUrlForNode(node: any): string | null {
  if (!node || typeof node !== 'object') return null
  if (!IMAGE_NODE_TYPES.has(node.type)) return null

  const data = node.data
  if (!data || typeof data !== 'object') return null

  const rendered = Array.isArray(data.images) ? data.images[0] : null
  if (typeof rendered === 'string' && rendered) return rendered

  const filename = widgetValueByName(data, 'image')
  if (!filename) return null
  return `/view?${new URLSearchParams({ filename, type: 'input' })}`
}
