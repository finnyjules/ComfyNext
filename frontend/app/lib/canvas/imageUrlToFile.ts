/**
 * Fetch an image URL and wrap it as a File suitable for /upload/image.
 * Shared by the Compositor paste path and the "pick a canvas image" add path.
 * The name is taken from the URL's `?filename=` param (ComfyUI /view URLs carry
 * it) or `fallbackName` otherwise. Throws on a non-ok response or a non-image
 * blob so callers can toast/log rather than silently add a broken layer.
 */
export async function imageUrlToFile(url: string, fallbackName = 'canvas.png'): Promise<File> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(`not an image (${blob.type || 'unknown'})`)
  const name = new URLSearchParams(url.split('?')[1] ?? '').get('filename') || fallbackName
  return new File([blob], name, { type: blob.type })
}
