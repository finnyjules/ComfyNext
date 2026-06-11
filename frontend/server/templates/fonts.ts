/**
 * Pure helpers for uploaded ("Brand fonts") font management — shared by the
 * upload/list/delete endpoints (server/api/template-fonts/*) and the render
 * loader (render-template.post.ts). Kept side-effect-free so the validation +
 * manifest logic is unit-tested without HTTP or the filesystem.
 *
 * satori can't parse woff2, so we accept .ttf/.otf/.woff only and sniff the
 * magic bytes to reject a woff2 renamed with an accepted extension.
 */

export type FontWeight = '400' | '700'

/** One uploaded family; `weights` maps a weight to its stored filename. */
export interface UploadedFont {
  family: string
  slug: string
  weights: Record<FontWeight, string>
}

export const ACCEPTED_EXTS = ['.ttf', '.otf', '.woff'] as const
export const MAX_FONT_BYTES = 2 * 1024 * 1024 // 2 MB

/** Filesystem-safe family slug; falls back to "font" for empty/garbage input. */
export function slugifyFamily(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font'
}

/** Detect a font container from its leading magic bytes. */
export function sniffFontType(bytes: Uint8Array): 'ttf' | 'otf' | 'woff' | 'woff2' | null {
  if (bytes.length < 4) return null
  const [a, b, c, d] = bytes
  const tag = String.fromCharCode(a, b, c, d)
  if (tag === 'OTTO') return 'otf'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'true' || tag === 'ttcf') return 'ttf'
  // 0x00010000 — the standard TrueType outline version tag.
  if (a === 0x00 && b === 0x01 && c === 0x00 && d === 0x00) return 'ttf'
  return null
}

export type ValidationResult = { ok: true } | { ok: false; reason: string }

/** Gate an upload by extension, size and sniffed container type. */
export function validateUpload(input: { ext: string; size: number; bytes: Uint8Array }): ValidationResult {
  const ext = input.ext.toLowerCase()
  if (!(ACCEPTED_EXTS as readonly string[]).includes(ext)) {
    return { ok: false, reason: `Unsupported file type ${ext}. Use .ttf, .otf or .woff (not .woff2).` }
  }
  if (input.size > MAX_FONT_BYTES) {
    return { ok: false, reason: `Font is too large (max ${Math.round(MAX_FONT_BYTES / 1024 / 1024)} MB).` }
  }
  const sniffed = sniffFontType(input.bytes)
  if (sniffed === 'woff2') {
    return { ok: false, reason: 'woff2 fonts can’t be rendered — upload .ttf, .otf or .woff.' }
  }
  if (sniffed !== 'ttf' && sniffed !== 'otf' && sniffed !== 'woff') {
    return { ok: false, reason: 'File doesn’t look like a font.' }
  }
  return { ok: true }
}

/**
 * Add or replace a family's weight in the manifest. A brand-new family's single
 * weight is mirrored to both 400 and 700 so it renders immediately; a later real
 * second weight overwrites the mirror. Families are unique by slug, order kept.
 */
export function upsertManifest(
  manifest: UploadedFont[],
  entry: { family: string; slug: string; weight: FontWeight; file: string },
): UploadedFont[] {
  const out = manifest.map(f => ({ ...f, weights: { ...f.weights } }))
  const existing = out.find(f => f.slug === entry.slug)
  if (!existing) {
    // Mirror the single uploaded weight to the other so both 400/700 resolve.
    const weights = { '400': entry.file, '700': entry.file } as Record<FontWeight, string>
    weights[entry.weight] = entry.file
    out.push({ family: entry.family, slug: entry.slug, weights })
    return out
  }
  existing.family = entry.family
  existing.weights[entry.weight] = entry.file
  return out
}
