/**
 * GET /api/moodboards/images?folder=moodboard_123           → { files } (sorted)
 * GET /api/moodboards/images?folder=moodboard_123&file=x.png → raw image bytes
 *
 * Path-guarded (the training-image.get.ts pattern): folder must be a
 * moodboard_<ms> name — NEVER a lora_dataset_* folder — and file a bare image
 * name with no traversal. Must be allowlisted in comfyui-proxy.ts.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MOODBOARD_FOLDER_RE } from '../../../shared/taste/moodboard'
import { moodboardInputDir, safeImageFile } from '../../utils/moodboardImages'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const folder = String(q.folder || '')
  const file = String(q.file || '')

  if (!MOODBOARD_FOLDER_RE.test(folder)) throw createError({ statusCode: 400, statusMessage: 'invalid folder' })

  // List mode: image files in the folder, sorted.
  if (!file) {
    let names: string[] = []
    try { names = await fs.readdir(path.join(moodboardInputDir(), folder)) }
    catch { throw createError({ statusCode: 404, statusMessage: 'not found' }) }
    return { files: names.filter(safeImageFile).sort() }
  }

  // Serve mode: one raw image.
  if (!safeImageFile(file)) throw createError({ statusCode: 400, statusMessage: 'invalid file' })

  const abs = path.resolve(moodboardInputDir(), folder, file)
  let buf: Buffer
  try { buf = await fs.readFile(abs) }
  catch { throw createError({ statusCode: 404, statusMessage: 'not found' }) }

  const ext = file.split('.').pop()!.toLowerCase()
  setResponseHeader(event, 'Content-Type', MIME[ext] || 'application/octet-stream')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return buf
})
