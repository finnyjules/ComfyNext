/**
 * POST /api/house-styles/update-profile   (dev-only)
 *
 * Cheap, targeted update: overwrite ONLY the `tasteProfile` of an already-published
 * style in app/data/house-styles.json, matched by its `id`. Unlike publish.post.ts
 * this touches nothing else — no thumbnail re-bake — so upgrading a profile (e.g.
 * from a Fable rewrite) costs nothing and can't disturb the entry.
 *
 * Matched by id, not replicateModel: several styles may share one trained model
 * (same training run, different taste profile), so the model ref is ambiguous and
 * would edit an arbitrary one of them.
 *
 * Body: { id: string, tasteProfile: string }
 * Must be allowlisted via the '/api/house-styles' prefix in comfyui-proxy.ts.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { HouseStyleEntry } from '../../utils/houseStylesStore'

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody(event) as { id?: string, tasteProfile?: string }
  const id = String(body?.id || '').trim()
  const profile = String(body?.tasteProfile || '')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  if (profile.trim().length <= 40) {
    throw createError({ statusCode: 400, statusMessage: 'taste profile too short (>40 chars required)' })
  }

  const jsonPath = path.resolve(process.cwd(), 'app', 'data', 'house-styles.json')
  const current = JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as HouseStyleEntry[]
  const entry = current.find(e => e.id === id)
  if (!entry) throw createError({ statusCode: 404, statusMessage: `no published style with id ${id}` })

  entry.tasteProfile = profile.trim()
  await fs.writeFile(jsonPath, `${JSON.stringify(current, null, 2)}\n`)

  return { ok: true, id: entry.id }
})
