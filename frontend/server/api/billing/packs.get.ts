/**
 * Public UI data for the decided credit ladder (Task 4). Still behind the
 * hosted-mode gate: 404 in local mode, same as checkout.post.ts.
 */
import { isHosted } from '~~/server/utils/deployMode'
import { PACKS } from '~~/server/utils/packs'

export function packsPayload() {
  return { packs: PACKS }
}

export default defineEventHandler(() => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  return packsPayload()
})
