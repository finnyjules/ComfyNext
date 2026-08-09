/**
 * Shared client catalog over the committed font-library manifest. The single
 * consumer-facing surface for both font worlds: pickers read the grouped
 * families; the CSS world builds @font-face from faces; the outline world
 * resolves a `local:Family@weight` token to a route URL via the resolver this
 * module installs into outlines.ts. Network-free (imports static JSON only).
 */
import manifest from './library-fonts.manifest.json'
import type { LibraryManifest, LibraryFamily, LibraryFace, LibraryFoundry } from '~~/shared/library-fonts'
import { setLibraryFamilies } from '~/lib/font/resolveFamily'
import { setLibraryFaceResolver } from '~/lib/scene3d/outlines'

export const LIBRARY_FONTS = manifest as unknown as LibraryManifest

const byFamily = new Map<string, LibraryFamily>(LIBRARY_FONTS.families.map(f => [f.family, f]))

export function librariesByFoundry(): { foundry: LibraryFoundry; families: LibraryFamily[] }[] {
  return LIBRARY_FONTS.foundries.map(foundry => ({
    foundry,
    families: LIBRARY_FONTS.families.filter(f => f.foundry === foundry.id),
  }))
}

export function libraryFamily(family: string): LibraryFamily | null {
  return byFamily.get(family) ?? null
}

export function libraryFontUrl(faceId: string): string {
  return `/api/library-font/${encodeURIComponent(faceId)}`
}

/**
 * Nearest face for family + weight. When `italic` is specified, only faces of
 * that slant are considered; if none exist, falls back to the other slant so a
 * family that ships italics-only still resolves. Nearest weight by abs distance.
 */
export function resolveLibraryFace(family: string, weight = 400, italic?: boolean): LibraryFace | null {
  const fam = byFamily.get(family)
  if (!fam || !fam.faces.length) return null
  let pool = fam.faces
  if (italic !== undefined) {
    const slant = fam.faces.filter(f => f.italic === italic)
    pool = slant.length ? slant : fam.faces
  }
  return pool.reduce((best, f) =>
    Math.abs(f.weight - weight) < Math.abs(best.weight - weight) ? f : best, pool[0]!)
}

/** Install this module into the two resolver hooks. Called once at startup. */
export function registerLibraryFonts(): void {
  setLibraryFamilies(LIBRARY_FONTS.families.map(f => ({
    family: f.family,
    weights: [...new Set(f.faces.map(x => x.weight))].sort((a, b) => a - b),
    axes: [], // static instances — no continuous wght axis
  })))
  setLibraryFaceResolver((family, weight, italic) => {
    const face = resolveLibraryFace(family, weight, italic)
    return face ? face.id : null
  })
}
