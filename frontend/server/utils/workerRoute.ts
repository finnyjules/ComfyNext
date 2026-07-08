// Resolves which ComfyUI backend instance a request should be routed to.
//
// Parallel dispatch spawns extra headless ComfyUI workers on ports 8189+N
// (see comfyWorkerPool.ts, workerPort()) alongside the user's own canvas
// session on the main instance (:8188). Browser traffic opts into a worker
// via a `?comfyWorker=N` query param; this is the single canonical parser for
// that param, shared (conceptually) by both routing call sites:
//   - server/middleware/comfyui-proxy.ts (HTTP proxy)
//   - nuxt.config.ts's inline "comfy-ws-proxy" upgrade dispatcher — which
//     CANNOT import this module (nuxt.config is evaluated before Nitro's
//     server/ context exists), so it duplicates this ~10-line parse inline
//     with a comment pointing back here. Keep the two in sync by hand.
const MAIN_PORT = 8188
const WORKER_BASE_PORT = 8189
const MAX_WORKER_INDEX = 7

/**
 * Parses `comfyWorker=N` off `url`'s query string.
 *
 * - Absent, non-numeric, negative, or > 7 → { port: 8188, cleanUrl: url unchanged (param stripped if present) }
 * - 0 <= N <= 7 → { port: 8189 + N, cleanUrl }
 *
 * `cleanUrl` always has the `comfyWorker` param removed; every other param
 * (and their order) is preserved. A trailing `?` left behind by stripping the
 * only param is dropped.
 */
export function resolveWorkerTarget(url: string): { port: number; cleanUrl: string } {
  const [path, query = ''] = splitUrl(url)

  if (!query) return { port: MAIN_PORT, cleanUrl: url }

  const params = new URLSearchParams(query)
  if (!params.has('comfyWorker')) return { port: MAIN_PORT, cleanUrl: url }

  const raw = params.get('comfyWorker')
  params.delete('comfyWorker')

  const rest = params.toString()
  const cleanUrl = rest ? `${path}?${rest}` : path

  const n = raw === null || raw === '' ? NaN : Number(raw)
  const valid = Number.isInteger(n) && n >= 0 && n <= MAX_WORKER_INDEX
  const port = valid ? WORKER_BASE_PORT + n : MAIN_PORT

  return { port, cleanUrl }
}

function splitUrl(url: string): [string, string?] {
  const i = url.indexOf('?')
  if (i === -1) return [url]
  return [url.slice(0, i), url.slice(i + 1)]
}
