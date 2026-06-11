/**
 * App-wide uploaded ("Brand fonts") library. File-backed via /api/template-fonts
 * (mirrors useBrandLibrary). Owns fetching the list, uploading/removing, and
 * injecting an @font-face per family so the browser renders real previews —
 * the server render loader (render-template.post.ts) registers the same files
 * for satori, so a brand-bound font looks identical in the editor and the PNG.
 */
import { computed, ref } from 'vue'

export interface UploadedFontEntry {
  family: string
  slug: string
  weights: Partial<Record<'400' | '700', string>>  // weight → stored filename
}

const fonts = ref<UploadedFontEntry[]>([])
const loaded = ref(false)
const ensured = new Set<string>()  // slugs with an injected @font-face

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/template-fonts')
    if (res.ok) fonts.value = (await res.json()).fonts ?? []
    loaded.value = true
  } catch { /* offline dev — keep last list */ }
}

/** CSS-escape a family name for use inside a quoted @font-face value. */
function cssEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/** Drop the injected @font-face for a slug so a re-upload re-injects fresh. */
function purge(slug: string): void {
  if (typeof document === 'undefined') return
  document.querySelectorAll(`style[data-uploaded-font="${slug}"]`).forEach(el => el.remove())
  ensured.delete(slug)
}

/** Make the browser render `family` with the uploaded face(s). Idempotent. */
function ensure(family: string | null | undefined): void {
  if (!family || typeof document === 'undefined') return
  const entry = fonts.value.find(f => f.family === family)
  if (!entry || ensured.has(entry.slug)) return
  const faces = (['400', '700'] as const)
    .map(w => entry.weights[w] ? { w, file: entry.weights[w]! } : null)
    .filter((x): x is { w: '400' | '700'; file: string } => x !== null)
    .map(({ w, file }) =>
      `@font-face{font-family:'${cssEscape(entry.family)}';font-weight:${w};font-style:normal;`
      + `font-display:swap;src:url('/api/template-fonts/file/${encodeURIComponent(file)}')}`)
    .join('')
  if (!faces) return
  const style = document.createElement('style')
  style.dataset.uploadedFont = entry.slug
  style.textContent = faces
  document.head.appendChild(style)
  ensured.add(entry.slug)
}

async function upload(file: File, family: string, weight: '400' | '700'): Promise<UploadedFontEntry> {
  const fd = new FormData()
  fd.append('font', file)
  fd.append('family', family)
  fd.append('weight', weight)
  const res = await fetch('/api/template-fonts', { method: 'POST', body: fd })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.statusMessage || body.message || `Upload failed (${res.status})`)
  }
  const data = await res.json() as UploadedFontEntry
  purge(data.slug)        // re-upload: replace any stale @font-face
  await refresh()
  ensure(data.family)
  return data
}

async function remove(slug: string): Promise<void> {
  await fetch(`/api/template-fonts/${slug}`, { method: 'DELETE' })
  purge(slug)
  await refresh()
}

export function useUploadedFonts() {
  if (!loaded.value) void refresh()
  return {
    fonts,
    loaded,
    families: computed(() => fonts.value.map(f => f.family)),
    refresh,
    upload,
    remove,
    ensure,
  }
}
