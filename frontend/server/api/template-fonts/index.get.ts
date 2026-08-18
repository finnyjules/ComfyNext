/** List every uploaded brand font (from the manifest). */
import { readManifest } from '~~/server/templates/fonts-store'
import { ownerOf } from '../../utils/resourceOwners'
import { isHosted } from '../../utils/deployMode'

export default defineEventHandler(async (event) => {
  const fonts = await readManifest()
  if (!isHosted()) return { fonts }
  // Hosted: show the caller's fonts plus unowned/curated ones (id = slug).
  const userId = event.context.userId ?? null
  const mine = []
  for (const f of fonts) {
    const owner = await ownerOf('template-font', f.slug)
    if (owner === null || owner === userId) mine.push(f)
  }
  return { fonts: mine }
})
