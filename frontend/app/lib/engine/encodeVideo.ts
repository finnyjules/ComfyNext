/**
 * Single call site for POST /sailor/spacetype_encode, used by every studio's
 * "export as video" action. Centralised so the alpha flag and the resulting
 * file extension can't drift out of sync per-caller — a caller that requests
 * alpha but hardcodes `.mp4` would produce a WebM file the OS mislabels.
 *
 * The extension is derived from the RESPONSE filename, not the request: the
 * server is authoritative about what it actually encoded. If a future
 * server-side change ignores or downgrades an alpha request, a
 * request-derived extension would silently lie about the file's contents.
 */

export interface EncodeFramesOptions {
  /** input/ filenames, frame order (see ensureSpaceTypeBake). */
  frames: string[]
  fps: number
  width: number
  height: number
  /** VP9/WebM with alpha instead of the h264/mp4 default. */
  alpha?: boolean
}

export interface EncodeFramesResult {
  /** Server-written filename under input/, e.g. "spacetype_172...mp4". */
  filename: string
  /** Derived from `filename`'s actual extension, not from the request. */
  ext: 'mp4' | 'webm'
}

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; json: () => Promise<any> }>

/**
 * POST the frame sequence to the server-side encoder and resolve the
 * resulting filename + extension. Rejects with a descriptive Error — never
 * resolves to undefined — on a network failure, an unparseable response, or
 * a response with no filename (e.g. `{ "error": "..." }`).
 *
 * `fetchImpl` defaults to the global `fetch` and exists so tests can stub
 * the network call without a running server.
 */
export async function encodeFrames(
  opts: EncodeFramesOptions,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<EncodeFramesResult> {
  const body: Record<string, unknown> = {
    frames: opts.frames,
    fps: opts.fps,
    width: opts.width,
    height: opts.height,
  }
  if (opts.alpha) body.alpha = true

  let res: { ok: boolean; json: () => Promise<any> }
  try {
    res = await fetchImpl('/sailor/spacetype_encode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`video encode request failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const data = await res.json().catch(() => ({}) as any)
  const filename = data?.filename
  if (!filename || typeof filename !== 'string') {
    const reason = data?.error ? `: ${data.error}` : ''
    throw new Error(`video encode failed${reason}`)
  }

  const ext: EncodeFramesResult['ext'] = filename.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4'
  return { filename, ext }
}
