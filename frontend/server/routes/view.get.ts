import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { deployMode } from '../utils/deployMode'
import { ownedOutputKeys, outputKey } from '../utils/graphRuns'
import { harvestPendingOutputs } from '../utils/engineGate'

const COMFY_BACKEND = 'http://127.0.0.1:8188'
const CACHE_DIR = join(process.cwd(), '.cache', 'images')

function cacheKey(filename: string, type: string, subfolder: string): string {
  const hash = createHash('sha256').update(`${type}:${subfolder}:${filename}`).digest('hex').slice(0, 16)
  // Keep the original extension for MIME type detection
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : ''
  return `${hash}${ext}`
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const filename = query.filename as string
  const type = query.type as string || 'output'
  const subfolder = query.subfolder as string || ''

  if (!filename) {
    throw createError({ statusCode: 400, message: 'Missing filename' })
  }

  // Stage 5 Task 5: hosted output reads are tenant-scoped. `type` above is
  // already defaulted to 'output' when the query param is absent, so gating
  // on the EFFECTIVE type (not the raw query) covers both cases in one
  // check. type=temp/type=input stay ungated this stage (documented gap).
  if (deployMode() === 'hosted' && type === 'output') {
    const userId = event.context.userId
    if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })
    const key = outputKey({ filename, subfolder, type: 'output' })
    let owned = await ownedOutputKeys(userId)
    if (!owned.has(key)) {
      // Race window: the client saw the WS 'executed' event a beat before
      // the settle watcher recorded outputs. Harvest this user's pending
      // runs once, then re-check.
      await harvestPendingOutputs(userId)
      owned = await ownedOutputKeys(userId)
      if (!owned.has(key)) throw createError({ statusCode: 404, message: 'Image not found' })
    }
  }

  // Build the backend URL with original query params
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v != null) params.set(k, String(v))
  }
  const backendUrl = `${COMFY_BACKEND}/view?${params}`
  const cacheFile = join(CACHE_DIR, cacheKey(filename, type, subfolder))

  // Try fetching from ComfyUI first
  try {
    const res = await fetch(backendUrl)
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') || 'image/png'

      // Cache to disk (fire and forget for temp images, cache all for durability)
      mkdir(CACHE_DIR, { recursive: true })
        .then(() => writeFile(cacheFile, buffer))
        .catch(() => {})

      setResponseHeaders(event, {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      })
      return buffer
    }
  }
  catch {
    // ComfyUI might be down — fall through to cache
  }

  // Fallback: serve from cache
  if (existsSync(cacheFile)) {
    const buffer = await readFile(cacheFile)
    const ext = cacheFile.slice(cacheFile.lastIndexOf('.') + 1).toLowerCase()
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      mp4: 'video/mp4',
      webm: 'video/webm',
    }
    setResponseHeaders(event, {
      'content-type': mimeMap[ext] || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    })
    return buffer
  }

  throw createError({ statusCode: 404, message: 'Image not found' })
})
