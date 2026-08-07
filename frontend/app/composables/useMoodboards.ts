/**
 * App-wide moodboard library (file-backed via /api/moodboards). Mirrors
 * useBrandLibrary: module-singleton refs, optimistic save/remove with
 * rollback-to-server-truth via refresh. Library owns entries; canvas nodes
 * reference them by id (properties.sailor_moodboard).
 */
import { ref } from 'vue'
import type { MoodboardEntry } from '~~/shared/taste/moodboard'

const moodboards = ref<MoodboardEntry[]>([])
const loaded = ref(false)

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/moodboards')
    if (res.ok) moodboards.value = (await res.json()).moodboards ?? []
    loaded.value = true
  } catch { /* offline dev — keep last list */ }
}

async function save(entry: MoodboardEntry): Promise<void> {
  // Optimistic upsert so rapid successive edits (e.g. re-read then rename)
  // read each other's in-memory state instead of racing the PUT's round trip
  // and silently overwriting one another.
  const idx = moodboards.value.findIndex(m => m.id === entry.id)
  if (idx === -1) moodboards.value = [...moodboards.value, entry]
  else moodboards.value = moodboards.value.map((m, i) => (i === idx ? entry : m))

  try {
    const res = await fetch(`/api/moodboards/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    })
    if (!res.ok) throw new Error(`save moodboard failed: ${res.status}`)
  } catch (e) {
    // Covers both a !res.ok response AND a network-level rejection (fetch
    // throws, e.g. offline/DNS/CORS) — either way, roll back the optimistic
    // entry to server truth before the caller sees the failure.
    await refresh().catch(() => {}) // best-effort: never let rollback mask the original error
    throw e
  }
  await refresh()
}

async function remove(id: string): Promise<void> {
  // Optimistic removal — see save() above for rationale.
  moodboards.value = moodboards.value.filter(m => m.id !== id)
  await fetch(`/api/moodboards/${id}`, { method: 'DELETE' })
  await refresh()
}

function byId(id: string): MoodboardEntry | undefined {
  return moodboards.value.find(m => m.id === id)
}

export function slugifyMoodboardName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'moodboard'
}

export function useMoodboards() {
  if (!loaded.value) void refresh()
  return { moodboards, loaded, refresh, save, remove, byId, slugifyMoodboardName }
}
