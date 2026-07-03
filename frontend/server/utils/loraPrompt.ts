/**
 * Resolve a LoRA's style description from its sidecar, tolerating both schema
 * versions. Older sidecars store it under `aesthetic`; the cloud trainer now
 * writes `taste_profile`. Prefer `aesthetic`, fall back to `taste_profile`, and
 * SKIP blank values (a `??` chain wouldn't — it only falls back on null). Mirrors
 * the Python `sidecar_aesthetic()` in comfy_api_nodes/replicate_refs.py so the
 * restyle node, cover generation, and inference all read the same style.
 */
export function sidecarAesthetic(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return ''
  for (const key of ['aesthetic', 'taste_profile'] as const) {
    const v = meta[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/**
 * Parse a LoRA .json sidecar into a plain object, tolerating garbage. Crucially
 * `JSON.parse('null')` succeeds and returns `null` (and `'[1]'` returns an
 * array), which would then blow up any `meta.foo` access — a single sidecar file
 * containing `null` used to 500 the whole /api/loras-local list. Anything that
 * isn't a JSON object (null, array, string, number, invalid) normalizes to `{}`.
 */
export function parseSidecar(raw: string): Record<string, any> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {}
  } catch {
    return {}
  }
}

/**
 * Compose a trained-LoRA generation prompt from its sidecar style + the user's
 * text, mirroring the style branch of lora-cover.post.ts:
 *   "<aesthetic> <trigger>, <userPrompt>"
 * Any empty part is dropped. Returned string is trimmed.
 */
export function buildLoraPrompt(trigger: string, aesthetic: string, userPrompt: string): string {
  const t = (trigger || '').trim()
  const a = (aesthetic || '').trim()
  const p = (userPrompt || '').trim()
  return [a, t ? `${t},` : '', p].filter(Boolean).join(' ').trim()
}
