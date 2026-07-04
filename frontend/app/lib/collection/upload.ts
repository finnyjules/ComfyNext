import type { CollectionData, CollectionRow } from './types'
import { clampPreviewRow } from './model'
import { sanitize } from './generate'

let seq = 0
function uid(prefix: string): string {
  seq = (seq + 1) % 1_000_000
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}

/** Widening seam for v1's image-only accept list — broaden this (and the
 * upload/validation logic that reads it) when other media types land. */
export const IMAGE_ACCEPT = 'image/*'

/** Uploads a single file to ComfyUI's input dir (same `/upload/image` endpoint
 * as every other direct-upload path in the app — see `uploadFrameBatch` in
 * useKineticRenderer.ts) and returns its `/view` URL. Unlike `generate.ts`'s
 * `uploadAndRegister`, this does NOT register an asset_import — cell uploads
 * are INPUTS the user is populating a collection with, not generator outputs
 * that belong in the Assets library. */
export async function uploadMediaFile(file: File): Promise<string> {
  const fname = `collection_upload_${Date.now()}_${sanitize(file.name)}`
  const fd = new FormData()
  fd.append('image', new File([file], fname, { type: file.type || 'image/png' }))
  fd.append('overwrite', 'true')

  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('upload failed: ' + res.status)
  const meta = await res.json() as { name?: string; subfolder?: string }
  const name = meta.name ?? fname

  return `/view?${new URLSearchParams({
    filename: name,
    type: 'input',
    ...(meta.subfolder ? { subfolder: meta.subfolder } : {}),
  })}`
}

/** Appends one new row per url: each copies the CURRENT preview row's values
 * (preview clamped first; {} if the collection has no rows), overrides
 * `columnKey` with that url. Unlike `addSweepRows`, these are real uploaded
 * rows — NOT flagged `sweep: true`. Returns the newly appended rows. */
export function addMediaRows(c: CollectionData, columnKey: string, urls: string[]): CollectionRow[] {
  clampPreviewRow(c)
  const baseValues = c.rows[c.previewRow]?.values ?? {}
  const added: CollectionRow[] = []
  for (const url of urls) {
    const row: CollectionRow = { id: uid('row'), values: { ...baseValues, [columnKey]: url } }
    c.rows.push(row)
    added.push(row)
  }
  return added
}
