import { describe, it, expect } from 'vitest'
import { resolveLibraryFontPath } from '../../server/utils/libraryFontManifest'
import manifest from '../../app/data/library-fonts.manifest.json'
import type { LibraryManifest } from '../../shared/library-fonts'

const m = manifest as unknown as LibraryManifest
const ROOT = '/fonts-root'
const firstFace = m.families[0]!.faces[0]!

describe('resolveLibraryFontPath', () => {
  it('resolves a known face id to an absolute path under root', () => {
    const p = resolveLibraryFontPath(firstFace.id, ROOT)
    expect(p).toBe(`${ROOT}/${firstFace.src}`)
  })
  it('returns null for an unknown id', () => {
    expect(resolveLibraryFontPath('does-not-exist', ROOT)).toBeNull()
  })
  it('never escapes the root even if a src were malicious', () => {
    // ids come only from the manifest, but the resolver must still be safe.
    expect(resolveLibraryFontPath('../../etc/passwd', ROOT)).toBeNull()
  })
})
