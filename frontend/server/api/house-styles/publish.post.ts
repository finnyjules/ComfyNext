import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateHouseStyleEntry, upsertHouseStyle, findIdCollision, type HouseStyleEntry } from '../../utils/houseStylesStore'

interface Body {
  entry?: Omit<HouseStyleEntry, 'thumbnails'>
  thumbnails?: string[] // 4 × data:image/webp;base64,...
}

const WEBP_DATA_RE = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/

export default defineEventHandler(async (event) => {
  // Dev-tool only: writes into the repo tree (public/ + app/data/). Pages under
  // /dev are prod-stripped by nuxt.config, but server routes are NOT — guard here.
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody<Body>(event)
  if (!body?.entry) throw createError({ statusCode: 400, statusMessage: 'entry required' })
  if (!Array.isArray(body.thumbnails) || body.thumbnails.length !== 4)
    throw createError({ statusCode: 400, statusMessage: 'exactly 4 webp thumbnails required' })

  const id = String(body.entry.id || '')
  const entry: HouseStyleEntry = {
    ...body.entry,
    thumbnails: [1, 2, 3, 4].map(n => `/house-styles/${id}/thumb-${n}.webp`),
  }
  const errors = validateHouseStyleEntry(entry)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })

  const jsonPath = path.resolve(process.cwd(), 'app', 'data', 'house-styles.json')
  const current = JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as HouseStyleEntry[]

  const collision = findIdCollision(current, entry)
  if (collision) throw createError({ statusCode: 409, statusMessage: `id '${id}' already used by ${collision.replicateModel}` })

  const thumbDir = path.resolve(process.cwd(), 'public', 'house-styles', id)
  await fs.mkdir(thumbDir, { recursive: true })
  for (let i = 0; i < 4; i++) {
    const m = WEBP_DATA_RE.exec(body.thumbnails[i] || '')
    if (!m) throw createError({ statusCode: 400, statusMessage: `thumbnail ${i + 1} is not a webp data URL` })
    const buf = Buffer.from(m[1], 'base64')
    const isWebp = buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    if (!isWebp) throw createError({ statusCode: 400, statusMessage: `thumbnail ${i + 1} is not a valid webp` })
    await fs.writeFile(path.join(thumbDir, `thumb-${i + 1}.webp`), buf)
  }

  const next = upsertHouseStyle(current, entry)
  await fs.writeFile(jsonPath, `${JSON.stringify(next, null, 2)}\n`)

  return { ok: true, id, count: next.length }
})
