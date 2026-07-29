/**
 * POST /api/depth/estimate — monocular depth for an image in ComfyUI's input dir.
 *
 * Body:    { filename }  — an ImageLayer.filename, read straight off disk (no data-URL
 *                          round trip, since the file is already local).
 * Returns: { depthFilename, subfolder, cached }
 *
 * subfolder is returned SEPARATELY because /view proxies to ComfyUI, which takes the
 * subfolder as its own query param — a slash inside `filename` does not resolve.
 *
 * Runs Depth Anything V2 locally via transformers.js — no API call, no per-preview
 * bill. The pipeline is a module-level singleton so weights load once (~3.5s) and stay
 * warm; inference is ~1s. A cache hit never touches the model at all.
 *
 * Output convention: BRIGHT = NEAR (it's inverse depth / disparity, not distance).
 *
 * /api/depth is allowlisted in server/middleware/comfyui-proxy.ts — without that entry
 * the proxy forwards this to ComfyUI and it 404s.
 */
import { readFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'

import { depthCacheKey, depthCacheName } from '~~/server/utils/depthCache'

const MODEL = 'onnx-community/depth-anything-v2-small'
const INPUT_DIR = join(process.cwd(), '..', 'input')
const CACHE_SUBDIR = 'sailor_depth'
const CACHE_DIR = join(INPUT_DIR, CACHE_SUBDIR)

/** Depth drives a blur radius, not detail — full resolution buys nothing and costs
 *  cache size plus texture-upload time. Sources here run to 4k. */
const MAX_EDGE = 1024

let pipePromise: Promise<any> | null = null
function depthPipeline(): Promise<any> {
  if (!pipePromise) {
    pipePromise = import('@huggingface/transformers')
      .then(({ pipeline }) => pipeline('depth-estimation', MODEL))
      .catch((err) => { pipePromise = null; throw err }) // let the next request retry
  }
  return pipePromise
}

const exists = (p: string) => access(p).then(() => true, () => false)

export default defineEventHandler(async (event) => {
  const body = await readBody<{ filename?: string }>(event)
  const filename = (body?.filename ?? '').trim()
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw createError({ statusCode: 400, message: 'a bare filename is required' })
  }

  const srcPath = join(INPUT_DIR, filename)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(srcPath))
  } catch {
    throw createError({ statusCode: 404, message: `not found in input dir: ${filename}` })
  }

  const name = depthCacheName(depthCacheKey(bytes))
  const outPath = join(CACHE_DIR, name)
  if (await exists(outPath)) {
    return { depthFilename: name, subfolder: CACHE_SUBDIR, cached: true }
  }

  try {
    const pipe = await depthPipeline()
    const { depth } = await pipe(srcPath)

    const long = Math.max(depth.width, depth.height)
    const scaled = long > MAX_EDGE
      ? await depth.resize(
          Math.max(1, Math.round((depth.width / long) * MAX_EDGE)),
          Math.max(1, Math.round((depth.height / long) * MAX_EDGE)),
        )
      : depth

    await mkdir(CACHE_DIR, { recursive: true })
    await scaled.save(outPath)
  } catch (err) {
    throw createError({
      statusCode: 502,
      message: `depth estimation failed: ${(err as Error).message}`,
    })
  }

  return { depthFilename: name, subfolder: CACHE_SUBDIR, cached: false }
})
