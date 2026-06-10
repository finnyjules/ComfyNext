/**
 * Minimal Replicate prediction runner shared by the vector AI routes. Mirrors
 * the create-then-poll flow already used by /api/cloud-train/*, but waits inline
 * (SVG generation/vectorize finish in seconds) and returns the raw `output`.
 */
interface Prediction {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: unknown
  error?: string
}

/** Resolve a model's latest version hash. */
async function latestVersion(model: string, token: string): Promise<string> {
  const res = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Token ${token}` },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw createError({ statusCode: 502, message: `Replicate model lookup failed for ${model}: ${text || res.statusText}` })
  }
  const info = await res.json() as { latest_version?: { id?: string } }
  const v = info.latest_version?.id
  if (!v) throw createError({ statusCode: 502, message: `Model ${model} has no latest version` })
  return v
}

/**
 * Create a prediction and poll until it terminates. Returns `output`.
 * Throws a 5xx createError on failure/timeout.
 */
export async function runReplicate(
  model: string,
  input: Record<string, unknown>,
  token: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 90_000
  const pollMs = opts.pollMs ?? 1200
  const version = await latestVersion(model, token)

  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, input }),
  })
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '')
    throw createError({ statusCode: 502, message: `Replicate prediction create failed: ${text || createRes.statusText}` })
  }
  let pred = await createRes.json() as Prediction

  const deadline = Date.now() + timeoutMs
  while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    if (Date.now() > deadline) throw createError({ statusCode: 504, message: 'Replicate prediction timed out' })
    await new Promise(r => setTimeout(r, pollMs))
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (!pollRes.ok) continue
    pred = await pollRes.json() as Prediction
  }
  if (pred.status !== 'succeeded') {
    throw createError({ statusCode: 502, message: `Replicate prediction ${pred.status}: ${pred.error || 'unknown error'}` })
  }
  return pred.output
}

/** Fetch a Replicate output image URL and inline it as a base64 data URL. Lets
 *  the browser consume results without hitting CORS on the Replicate CDN. */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw createError({ statusCode: 502, message: `Failed to fetch Replicate output (${res.status})` })
  const contentType = res.headers.get('content-type') || 'image/png'
  const buf = Buffer.from(await res.arrayBuffer())
  return `data:${contentType};base64,${buf.toString('base64')}`
}

/** Normalize a Replicate output (string | string[] | {url}) to a single URL. */
export function firstOutputUrl(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0]
  if (output && typeof output === 'object' && typeof (output as any).url === 'string') return (output as any).url
  return null
}

/** Read the Replicate token (Settings → AI, falling back to NUXT_REPLICATE_TOKEN), or throw a clear 500. */
export function requireReplicateToken(): string {
  const token = getReplicateToken()
  if (!token) throw createError({ statusCode: 500, message: 'Replicate token not configured. Paste it in Settings → AI (or set NUXT_REPLICATE_TOKEN).' })
  return token
}
