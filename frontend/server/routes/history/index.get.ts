import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const COMFY_BACKEND = 'http://127.0.0.1:8188'
const CACHE_DIR = join(process.cwd(), '.cache')
const CACHE_FILE = join(CACHE_DIR, 'history.json')

async function loadCache(): Promise<Record<string, any>> {
  try {
    if (existsSync(CACHE_FILE)) {
      const raw = await readFile(CACHE_FILE, 'utf-8')
      return JSON.parse(raw)
    }
  }
  catch {}
  return {}
}

async function saveCache(data: Record<string, any>) {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(data))
  }
  catch (err) {
    console.error('[history cache] Failed to save:', err)
  }
}

export default defineEventHandler(async () => {
  const cached = await loadCache()

  // Try fetching live history from ComfyUI
  let live: Record<string, any> = {}
  try {
    const res = await fetch(`${COMFY_BACKEND}/history`)
    if (res.ok) {
      live = await res.json() as Record<string, any>
    }
  }
  catch {
    // ComfyUI might be down — use cache only
  }

  // Merge: live entries take priority, cached fills in the rest
  const merged = { ...cached, ...live }

  // If we got new live entries, persist the merged result
  if (Object.keys(live).length > 0 && Object.keys(merged).length > Object.keys(cached).length) {
    // Fire and forget — don't block the response
    saveCache(merged)
  }

  return merged
})
