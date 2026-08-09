import { join, resolve, sep } from 'node:path'
import manifest from '~~/app/data/library-fonts.manifest.json'
import type { LibraryManifest } from '~~/shared/library-fonts'

const m = manifest as unknown as LibraryManifest

/** Face id → relative src, built once. */
const srcById = new Map<string, string>(
  m.families.flatMap(f => f.faces.map(face => [face.id, face.src] as const)),
)

export function libraryManifest(): LibraryManifest { return m }

/**
 * Absolute path for a face id under `fontsRoot`, or null if the id is unknown
 * or the resolved path escapes the root (defence in depth — ids come from the
 * manifest, but never trust the join).
 */
export function resolveLibraryFontPath(id: string, fontsRoot: string): string | null {
  const src = srcById.get(id)
  if (!src) return null
  const rootAbs = resolve(fontsRoot)
  const full = resolve(join(rootAbs, src))
  if (full !== rootAbs && !full.startsWith(rootAbs + sep)) return null
  return full
}

/** Repo-root Assets/Fonts, overridable for other machines. */
export function libraryFontsRoot(): string {
  return process.env.SAILOR_FONTS_ROOT || resolve(process.cwd(), '..', m.fontsRoot)
}
