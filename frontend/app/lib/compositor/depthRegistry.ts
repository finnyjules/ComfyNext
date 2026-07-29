/**
 * Depth maps for image layers, held so paintLayer can read them SYNCHRONOUSLY.
 *
 * paintLayer must never await — so depth readiness is state, not a render-time fetch.
 * A layer with no depth yet renders through unchanged, and subscribers re-render when
 * it arrives. One in-flight request per filename; an error is retryable.
 */

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface Entry { status: Status; img: HTMLImageElement | null; message?: string }

let entries = new Map<string, Entry>()
let listeners = new Set<() => void>()

const notify = () => { for (const cb of [...listeners]) cb() }

/** /view proxies to ComfyUI, which takes `subfolder` as its own param — a slash inside
 *  `filename` does not resolve. */
export function depthUrl(depthFilename: string, subfolder: string): string {
  const q = new URLSearchParams({ filename: depthFilename, subfolder, type: 'input' })
  return `/view?${q}`
}

export function depthStatusFor(filename: string): Status {
  return entries.get(filename)?.status ?? 'idle'
}

/** Synchronous by design — safe to call from inside a paint. */
export function depthImageFor(filename: string): HTMLImageElement | null {
  const e = entries.get(filename)
  return e?.status === 'ready' ? e.img : null
}

export function depthMessageFor(filename: string): string {
  return entries.get(filename)?.message ?? ''
}

export function onDepthChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function fail(filename: string, message: string) {
  entries.set(filename, { status: 'error', img: null, message })
  notify()
}

export function requestDepth(filename: string): void {
  if (!filename) return
  const cur = entries.get(filename)
  // 'error' is deliberately retryable; 'loading' and 'ready' are not re-requested.
  if (cur && cur.status !== 'error') return

  entries.set(filename, { status: 'loading', img: null })
  notify()

  void (async () => {
    let url = ''
    try {
      const res = await fetch('/api/depth/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      if (!res.ok) return fail(filename, `depth request failed (${res.status})`)
      const data = await res.json()
      if (!data?.depthFilename) return fail(filename, 'depth request returned no file')
      url = depthUrl(data.depthFilename, data.subfolder ?? '')
    } catch (err) {
      return fail(filename, `depth request failed: ${(err as Error).message}`)
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => { entries.set(filename, { status: 'ready', img }); notify() }
    img.onerror = () => fail(filename, 'depth map could not be decoded')
    img.src = url
  })()
}

/** Test seam — clears cached entries and subscribers. */
export function __resetDepthRegistry(): void {
  entries = new Map()
  listeners = new Set()
}
