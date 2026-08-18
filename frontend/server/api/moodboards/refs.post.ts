/**
 * POST /api/moodboards/refs — flatten a board's first images into the input
 * ROOT so they can ride as project @refs (moodboards Plan B, Task B5).
 *
 * Why flatten instead of registering `moodboard_<ms>/<file>` subpaths: the
 * RefEntry.filename must resolve in EVERY app image surface, and ComfyUI's
 * /view endpoint basenames its `filename` param (server.py:
 * `filename = os.path.basename(filename)`), so a subpath filename 404s in
 * widget previews / ReferenceNode thumbs — verified live 2026-08-07 (the
 * backend graph loader itself, `folder_paths.get_annotated_filepath`, DOES
 * resolve subpaths; the widgets are the limiting surface). Copying the first
 * MOODBOARD_MAX_REFS images flat as `mb_<slug>_<i>.<ext>` makes the
 * registered names work everywhere.
 *
 * Body: `{ folder: 'moodboard_<ms>', slug: '<moodboard id>' }`
 * → `{ files: ['mb_<slug>_0.png', …] }` in the guarded list route's order.
 * Idempotent per slug — a re-save overwrites the same flat names. Guarded
 * like every moodboard route: folder must match MOODBOARD_FOLDER_RE (never a
 * lora_dataset_* folder), slug must match MOODBOARD_ID_RE (no traversal in
 * the minted names). Rides the /api/moodboards allowlist prefix.
 *
 * Stage 6 (Task 4): each flat root-level input written is recorded against
 * the caller in `input_uploads` (hosted only), keyed by its empty-subfolder
 * canonical key — the flat @ref becomes the caller's owned top-level input.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MOODBOARD_FOLDER_RE, MOODBOARD_ID_RE, MOODBOARD_MAX_REFS } from '../../../shared/taste/moodboard'
import { moodboardInputDir, safeImageFile } from '../../utils/moodboardImages'
import { canonicalUploadKey, recordUpload, uploadOwner } from '../../utils/inputUploads'
import { isHosted } from '../../utils/deployMode'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, any>>(event)
  const folder = String(body?.folder || '')
  const slug = String(body?.slug || '')

  if (!MOODBOARD_FOLDER_RE.test(folder)) throw createError({ statusCode: 400, statusMessage: 'invalid folder' })
  if (!MOODBOARD_ID_RE.test(slug)) throw createError({ statusCode: 400, statusMessage: 'invalid slug' })

  const inputDir = moodboardInputDir()
  let names: string[] = []
  try { names = await fs.readdir(path.join(inputDir, folder)) }
  catch { throw createError({ statusCode: 404, statusMessage: 'not found' }) }

  const hosted = isHosted()
  const userId = event.context.userId ?? null
  const sources = names.filter(safeImageFile).sort().slice(0, MOODBOARD_MAX_REFS)

  // I1 — this route reads files OUT of `folder` and re-records the copies as the
  // caller's owned inputs, so a cross-tenant read here launders ownership. Gate
  // it in hosted with the SAME own-or-curated per-file read images.get.ts
  // enforces (uploadOwner === caller or unowned/curated). A folder whose images
  // belong to another tenant is refused wholesale — 404, no copy, no record, no
  // existence disclosure — the moodboard-folder name (moodboard_<ms>) is
  // guessable, so this is the actual containment. Curated folders (no upload
  // rows) stay copyable; the caller's own folder passes.
  if (hosted) {
    for (const src of sources) {
      const owner = await uploadOwner(canonicalUploadKey('input', folder, src))
      if (owner !== null && owner !== userId) throw createError({ statusCode: 404, statusMessage: 'not found' })
    }
  }

  const files: string[] = []
  for (const [i, src] of sources.entries()) {
    const ext = src.split('.').pop()!.toLowerCase()
    const flat = `mb_${slug}_${i}.${ext}`
    await fs.copyFile(path.join(inputDir, folder, src), path.join(inputDir, flat))
    if (hosted && userId) await recordUpload(userId, canonicalUploadKey('input', '', flat))
    files.push(flat)
  }
  return { files }
})
