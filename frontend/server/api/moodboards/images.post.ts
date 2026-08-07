/**
 * POST /api/moodboards/images — multipart upload of moodboard images.
 *
 * Form fields: `folder` (optional — omitted mints `moodboard_${Date.now()}`),
 * files under `images` (JPEG/PNG/WebP). Saves into `<repo-root>/input/<folder>/`
 * and returns `{ folder, files }`. Uses server/utils/multipart.ts, NOT h3's
 * readMultipartFormData (RangeError over 64 MiB). Must be allowlisted in
 * comfyui-proxy.ts (rides the /api/moodboards prefix).
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MOODBOARD_FOLDER_RE } from '../../../shared/taste/moodboard'
import { moodboardInputDir, safeImageFile } from '../../utils/moodboardImages'
import { readUploadForm } from '../../utils/multipart'

export default defineEventHandler(async (event) => {
  const form = await readUploadForm(event)

  const folder = form.text('folder') || `moodboard_${Date.now()}`
  if (!MOODBOARD_FOLDER_RE.test(folder)) {
    throw createError({ statusCode: 400, statusMessage: 'invalid folder' })
  }

  const parts = await form.files('images')
  const valid = parts
    .map(p => ({ ...p, base: path.basename(p.filename ?? '') }))
    .filter(p => safeImageFile(p.base))
  if (valid.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'no valid image files (png/jpeg/webp under `images`)' })
  }

  const dir = path.join(moodboardInputDir(), folder)
  await fs.mkdir(dir, { recursive: true })

  const files: string[] = []
  for (const [i, part] of valid.entries()) {
    const name = `${String(i).padStart(2, '0')}_${part.base}`
    await fs.writeFile(path.join(dir, name), part.data)
    files.push(name)
  }
  return { folder, files }
})
