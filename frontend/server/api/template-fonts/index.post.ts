/**
 * Upload a licensed brand font. Multipart: `font` (file), `family` (string),
 * `weight` (400|700, default 400). Validates type/size, stores the file under
 * the gitignored user dir, and upserts the manifest (single weight mirrors to
 * both 400/700; a real second weight replaces the mirror — see ./fonts).
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { slugifyFamily, upsertManifest, validateUpload, type FontWeight } from '~~/server/templates/fonts'
import { readManifest, writeManifest, USER_FONTS_DIR } from '~~/server/templates/fonts-store'

export default defineEventHandler(async (event) => {
  const parts = await readMultipartFormData(event)
  if (!parts) throw createError({ statusCode: 400, statusMessage: 'Expected multipart form data' })

  const filePart = parts.find(p => p.name === 'font' && p.filename)
  const family = String(parts.find(p => p.name === 'family')?.data?.toString('utf8') ?? '').trim()
  const weightRaw = String(parts.find(p => p.name === 'weight')?.data?.toString('utf8') ?? '400').trim()
  const weight: FontWeight = weightRaw === '700' ? '700' : '400'

  if (!filePart?.data) throw createError({ statusCode: 400, statusMessage: 'Missing font file' })
  if (!family) throw createError({ statusCode: 400, statusMessage: 'Missing family name' })

  const ext = extname(filePart.filename ?? '').toLowerCase()
  const bytes = new Uint8Array(filePart.data.buffer, filePart.data.byteOffset, filePart.data.byteLength)
  const v = validateUpload({ ext, size: filePart.data.byteLength, bytes })
  if (!v.ok) throw createError({ statusCode: 400, statusMessage: v.reason })

  const slug = slugifyFamily(family)
  const file = `${slug}-${weight}${ext}`
  await mkdir(USER_FONTS_DIR, { recursive: true })
  await writeFile(join(USER_FONTS_DIR, file), filePart.data)

  const manifest = upsertManifest(await readManifest(), { family, slug, weight, file })
  await writeManifest(manifest)

  const entry = manifest.find(f => f.slug === slug)!
  return { ok: true, family: entry.family, slug, weights: entry.weights }
})
