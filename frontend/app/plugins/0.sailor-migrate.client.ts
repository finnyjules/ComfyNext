// One-time localStorage migration for the ComfyNext -> Sailor rebrand.
//
// Every persistence key was renamed from the `comfynext:` / `comfynext_` prefix
// to `sailor:` / `sailor_`, and brand occurrences INSIDE key names were renamed
// too (e.g. `comfynext:ComfyNext.AI.AnthropicApiKey` is now read as
// `sailor:Sailor.AI.AnthropicApiKey`). This copies existing values under the
// new keys on boot so projects list, pinned/hidden projects, brand kit, saved
// blocks, clientId, the Anthropic API key, and all settings survive the rename.
//
// v2: the first shipped version only remapped the PREFIX, stranding keys with
// the brand in their remainder (the API key) at `sailor:ComfyNext.*`. This
// version renames every case variant across the whole key, and also repairs
// keys the v1 pass half-migrated. Guarded by a v2 flag so it still runs once
// in browsers that already carry the v1 flag.
//
// Runs first (the `0.` filename prefix orders it ahead of other plugins) so the
// keys exist before any composable reads them. Only KEYS are rewritten; VALUES
// are copied verbatim (they may reference existing `comfynext_*.png` input files,
// which are intentionally left on disk under their original names).
const MIGRATED_FLAG_V2 = 'sailor:migrated-from-comfynext.v2'

function newKeyFor(oldKey: string): string {
  return oldKey
    .replace(/ComfyNext/g, 'Sailor')
    .replace(/COMFYNEXT/g, 'SAILOR')
    .replace(/comfynext/g, 'sailor')
}

export default defineNuxtPlugin(() => {
  try {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(MIGRATED_FLAG_V2)) return

    // Snapshot keys up front — we mutate localStorage while iterating.
    // Covers both untouched legacy keys (`comfynext...`) and keys the v1
    // shim half-migrated (`sailor:ComfyNext...`).
    const staleKeys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /comfynext/i.test(k)) staleKeys.push(k)
    }

    for (const oldKey of staleKeys) {
      const newKey = newKeyFor(oldKey)
      if (newKey === oldKey) continue // e.g. flag keys with no brand inside
      // Don't clobber a value already written under the new key.
      if (localStorage.getItem(newKey) !== null) continue
      const value = localStorage.getItem(oldKey)
      if (value !== null) localStorage.setItem(newKey, value)
    }

    localStorage.setItem(MIGRATED_FLAG_V2, '1')
  } catch {
    // A migration must never block app boot.
  }
})
