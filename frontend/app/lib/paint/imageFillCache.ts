/**
 * Decoded-bitmap cache for `ImageFill` paints, keyed by the fill's snapshot
 * `src`. The synchronous `resolvePaint`/`paintTileBox` arms read it via
 * `getFillBitmap`; render hosts fill it ahead of the paint pass via
 * `ensureFillBitmaps` (wired into `ensureLayerImages`) — the same
 * preload-then-paint shape image LAYERS already use. DOM is touched only inside
 * function bodies, so this stays importable by the CPU-only `lib/` modules.
 */
const cache = new Map<string, HTMLImageElement>()
const inFlight = new Set<string>()
const failed = new Set<string>()

/** A decoded bitmap for `src`, or null if it isn't loaded yet / failed. */
export function getFillBitmap(src: string): HTMLImageElement | null {
  const im = cache.get(src)
  return im && im.complete && im.naturalWidth > 0 ? im : null
}

/** Whether `src` previously failed to decode. Callers use this to stop
 *  re-requesting a dead URL on every redraw. */
export function hasFillBitmapFailed(src: string): boolean {
  return failed.has(src)
}

/** Decode every `src` not already loaded/in-flight/known-failed. Resolves when
 *  this call's jobs settle. `onReady` fires per successful decode so a host
 *  can re-render. */
export function ensureFillBitmaps(srcs: string[], onReady?: () => void): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  const jobs: Promise<unknown>[] = []
  for (const src of srcs) {
    if (!src) continue
    if (getFillBitmap(src) || inFlight.has(src) || failed.has(src)) continue
    inFlight.add(src)
    jobs.push(new Promise((res) => {
      const im = new Image()
      im.crossOrigin = 'anonymous'
      im.onload = () => { failed.delete(src); cache.set(src, im); inFlight.delete(src); onReady?.(); res(null) }
      im.onerror = () => { failed.add(src); inFlight.delete(src); res(null) }
      im.src = src
    }))
  }
  return jobs.length ? Promise.all(jobs).then(() => {}) : Promise.resolve()
}
