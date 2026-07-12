/** Pre-fetch every http(s) image in a satori tree and inline it as a data
 * URI — BEFORE satori renders. Two reasons:
 *  1. satori's own remote-image loading fails SILENTLY (a 404/timeout just
 *     skips the image and yields a plausible-but-wrong PNG — batch exports
 *     shipped imageless outputs this way);
 *  2. inlining makes failures loud: a dead URL rejects the whole render so
 *     the caller (runBatch item, backend run) surfaces a retryable error.
 * `data:` URIs pass through untouched; non-http schemes are left as-is.
 */

interface TreeNode { type?: string; props?: { src?: string; children?: unknown } }

function collectImgNodes(node: unknown, out: TreeNode[] = []): TreeNode[] {
  if (!node || typeof node !== 'object') return out
  const n = node as TreeNode
  if (n.type === 'img' && typeof n.props?.src === 'string') out.push(n)
  const kids = n.props?.children
  if (Array.isArray(kids)) kids.forEach(k => collectImgNodes(k, out))
  else if (kids && typeof kids === 'object') collectImgNodes(kids, out)
  return out
}

export type ImageFetcher = (url: string) => Promise<{ data: ArrayBuffer; contentType: string }>

export async function defaultImageFetcher(url: string): Promise<{ data: ArrayBuffer; contentType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed (${res.status}): ${url}`)
  return { data: await res.arrayBuffer(), contentType: res.headers.get('content-type') || 'image/png' }
}

/** Mutates the tree in place: every http(s) img src becomes a data URI.
 *  Duplicate URLs are fetched once. Throws on the first failed fetch. */
export async function inlineTreeImages(tree: unknown, fetcher: ImageFetcher = defaultImageFetcher): Promise<void> {
  const imgs = collectImgNodes(tree)
  const byUrl = new Map<string, TreeNode[]>()
  for (const n of imgs) {
    const src = n.props!.src!
    if (!/^https?:\/\//.test(src)) continue
    const list = byUrl.get(src) ?? []
    list.push(n)
    byUrl.set(src, list)
  }
  await Promise.all([...byUrl.entries()].map(async ([url, nodes]) => {
    const { data, contentType } = await fetcher(url)
    const dataUri = `data:${contentType};base64,${Buffer.from(data).toString('base64')}`
    for (const n of nodes) n.props!.src = dataUri
  }))
}
