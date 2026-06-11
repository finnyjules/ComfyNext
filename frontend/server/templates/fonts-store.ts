/**
 * Filesystem store for uploaded brand fonts. The pure validation + manifest
 * logic lives in ./fonts (unit-tested); this module owns the side effects:
 * the gitignored `user/` dir and its `index.json` manifest. Shared by the
 * template-fonts endpoints and the render loader.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { UploadedFont } from './fonts'

export const USER_FONTS_DIR = join(process.cwd(), 'server', 'templates', 'fonts', 'user')
const MANIFEST_PATH = join(USER_FONTS_DIR, 'index.json')

/** Read the manifest; returns [] when the dir/manifest is missing (fresh checkout). */
export async function readManifest(): Promise<UploadedFont[]> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
    return Array.isArray(parsed) ? parsed as UploadedFont[] : []
  } catch {
    return []
  }
}

export async function writeManifest(manifest: UploadedFont[]): Promise<void> {
  await mkdir(USER_FONTS_DIR, { recursive: true })
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8')
}
