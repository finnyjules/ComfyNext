import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const COMFY_BACKEND = 'http://127.0.0.1:8188'
const CACHE_FILE = join(process.cwd(), '.cache', 'history.json')

export default defineEventHandler(async (event) => {
  const promptId = getRouterParam(event, 'promptId')
  if (!promptId) {
    throw createError({ statusCode: 400, message: 'Missing promptId' })
  }

  // Try live first
  try {
    const res = await fetch(`${COMFY_BACKEND}/history/${promptId}`)
    if (res.ok) {
      const data = await res.json() as Record<string, any>
      // ComfyUI returns {} when the promptId doesn't exist — check it actually has data
      if (data[promptId]) {
        return data
      }
    }
  }
  catch {
    // ComfyUI might be down
  }

  // Fallback to cache
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, 'utf-8')
      const cached = JSON.parse(raw)
      if (cached[promptId]) {
        return { [promptId]: cached[promptId] }
      }
    }
  }
  catch {}

  throw createError({ statusCode: 404, message: 'History entry not found' })
})
