/** List every uploaded brand font (from the manifest). */
import { readManifest } from '~~/server/templates/fonts-store'

export default defineEventHandler(async () => {
  return { fonts: await readManifest() }
})
