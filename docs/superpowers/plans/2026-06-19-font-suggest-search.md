# Describe-to-Suggest Font Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users type a free-text description ("fonts like the New York Knicks logo") in either font picker and get a ✨ Suggested section of real Google Fonts families, each rendered in its own face with a one-line reason.

**Architecture:** A new Nitro route `/api/font-suggest` calls Claude Haiku 4.5 (structured JSON, user's Anthropic key from localStorage), then *grounds* the model's suggested family names against the real ~1900-family Google catalog — dropping any that don't exist and normalizing to canonical spelling. A thin composable drives both pickers, which render the grounded suggestions in a ✨ section pinned above their normal literal-search list. The matching logic and the key/error decision live in pure modules so they're unit-tested without network or Vue runtime.

**Tech Stack:** Nuxt 4 / Nitro (server routes), Vue 3 `<script setup>`, TypeScript, Vitest (`npm run test:unit`), Anthropic Messages API (raw fetch, no SDK).

---

## File Structure

- **Create** `frontend/server/utils/googleCatalog.ts` — shared Google catalog fetch/transform/cache (extracted from `google-fonts.get.ts`). Exports `getGoogleCatalog()` + `GoogleFont`.
- **Modify** `frontend/server/api/google-fonts.get.ts` — becomes a thin handler over `getGoogleCatalog()`.
- **Create** `frontend/server/utils/fontMatch.ts` — pure grounding logic. Exports `normalizeFamily()`, `groundSuggestions()`.
- **Create** `frontend/server/api/font-suggest.post.ts` — Haiku call + grounding, returns grounded suggestions.
- **Create** `frontend/app/lib/fontSuggest.ts` — pure request/error helper. Exports `STANDARD_KEY_ERROR`, `buildSuggestRequest()`, `FontSuggestion` type.
- **Create** `frontend/app/composables/useFontSuggest.ts` — thin composable (refs + `$fetch`).
- **Modify** `frontend/app/components/templates/FontPicker.vue` — ✨ button + Suggested section.
- **Modify** `frontend/app/components/vue-canvas/widgets/FontPicker.vue` — ✨ button + Suggested section.
- **Create** `frontend/tests/unit/font-match.unit.spec.ts` — tests for `fontMatch.ts`.
- **Create** `frontend/tests/unit/font-suggest-request.unit.spec.ts` — tests for `fontSuggest.ts`.

All commands below run from `frontend/`.

---

### Task 1: Extract the Google catalog into a shared server util

**Files:**
- Create: `frontend/server/utils/googleCatalog.ts`
- Modify: `frontend/server/api/google-fonts.get.ts`

- [ ] **Step 1: Create the shared util**

Create `frontend/server/utils/googleCatalog.ts` by moving the fetch/transform/cache logic out of the existing route:

```typescript
/**
 * Shared Google Fonts catalog loader. The metadata endpoint isn't CORS-friendly
 * and ships JSON behind an XSSI guard (`)]}'`), so we fetch + clean it server-side
 * and cache in-memory for a day. Used by /api/google-fonts (the picker catalog)
 * and /api/font-suggest (grounding LLM suggestions against real families).
 */
const SOURCE = 'https://fonts.google.com/metadata/fonts'
const TTL_MS = 24 * 60 * 60 * 1000

const CATEGORY: Record<string, string> = {
  'Sans Serif': 'sans',
  'Serif': 'serif',
  'Display': 'display',
  'Monospace': 'mono',
  'Handwriting': 'handwriting',
}

// Show the familiar axes first; everything else keeps its catalog order after.
const AXIS_ORDER = ['wght', 'wdth', 'slnt', 'opsz', 'ital']

export interface GoogleFont {
  family: string
  category: string
  weights: number[]
  italic: boolean
  axes: { tag: string; min: number; max: number; default: number }[]
}

let cache: { at: number; fonts: GoogleFont[] } | null = null

function transform(list: any[]): GoogleFont[] {
  const out: GoogleFont[] = []
  for (const meta of list) {
    if (!meta || typeof meta.family !== 'string') continue
    const keys = Object.keys(meta.fonts ?? {})
    const weights = [...new Set(
      keys.filter(k => !k.endsWith('i')).map(k => parseInt(k, 10)).filter(Number.isFinite),
    )].sort((a, b) => a - b)
    const axes = (Array.isArray(meta.axes) ? meta.axes : [])
      .map((a: any) => ({ tag: String(a.tag), min: +a.min, max: +a.max, default: +a.defaultValue }))
      .sort((x: any, y: any) => {
        const ix = AXIS_ORDER.indexOf(x.tag), iy = AXIS_ORDER.indexOf(y.tag)
        return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
      })
    out.push({
      family: meta.family,
      category: CATEGORY[meta.category] ?? 'sans',
      weights: weights.length ? weights : [400],
      italic: keys.some(k => k.endsWith('i')),
      axes,
    })
  }
  return out
}

export async function getGoogleCatalog(): Promise<GoogleFont[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.fonts

  let raw: string
  try {
    const r = await fetch(SOURCE, { headers: { Accept: 'application/json' } })
    if (!r.ok) throw createError({ statusCode: 502, message: `Google Fonts metadata ${r.status}` })
    raw = await r.text()
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({ statusCode: 502, message: `Couldn't reach Google Fonts: ${err?.message ?? err}` })
  }

  let data: any
  try {
    data = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''))
  } catch {
    throw createError({ statusCode: 502, message: 'Google Fonts metadata was not valid JSON' })
  }

  const fonts = transform(data?.familyMetadataList ?? [])
  cache = { at: Date.now(), fonts }
  return fonts
}
```

- [ ] **Step 2: Slim down the route to use it**

Replace the entire contents of `frontend/server/api/google-fonts.get.ts` with:

```typescript
/**
 * GET /api/google-fonts
 *
 * Returns the full Google Fonts catalog as a slim list the Font Playground's
 * picker can search. Catalog fetch/cache lives in server/utils/googleCatalog.ts
 * (shared with /api/font-suggest). No API key required.
 *
 * Response: `{ fonts: GoogleFont[], count: number }`.
 */
import { getGoogleCatalog } from '../utils/googleCatalog'

export default defineEventHandler(async () => {
  const fonts = await getGoogleCatalog()
  return { fonts, count: fonts.length }
})
```

- [ ] **Step 3: Verify the route still serves the catalog**

Run: `npm run dev` in one shell, then in another:
`curl -s http://localhost:3000/api/google-fonts | head -c 200`
Expected: JSON starting with `{"fonts":[{"family":` and a large `"count"`. Stop the dev server after.

(No automated test for this task — it's network glue, exercised manually here and by the existing picker.)

- [ ] **Step 4: Commit**

```bash
git add frontend/server/utils/googleCatalog.ts frontend/server/api/google-fonts.get.ts
git commit -m "refactor(fonts): extract shared getGoogleCatalog util"
```

---

### Task 2: Pure grounding logic (`fontMatch.ts`) — TDD

**Files:**
- Create: `frontend/tests/unit/font-match.unit.spec.ts`
- Create: `frontend/server/utils/fontMatch.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/font-match.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeFamily, groundSuggestions } from '~~/server/utils/fontMatch'

const CATALOG = [
  { family: 'Roboto', category: 'sans' },
  { family: 'DM Serif Display', category: 'serif' },
  { family: 'Bebas Neue', category: 'display' },
  { family: 'Playfair Display', category: 'serif' },
]

describe('normalizeFamily', () => {
  it('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeFamily('  DM   Serif  Display ')).toBe('dm serif display')
    expect(normalizeFamily('Roboto')).toBe('roboto')
  })
})

describe('groundSuggestions', () => {
  it('keeps exact matches and uses the catalog canonical spelling + category', () => {
    const out = groundSuggestions([{ family: 'roboto', reason: 'clean sans' }], CATALOG)
    expect(out).toEqual([{ family: 'Roboto', reason: 'clean sans', category: 'sans' }])
  })

  it('matches case- and whitespace-insensitively', () => {
    const out = groundSuggestions([{ family: 'bebas  neue', reason: 'bold' }], CATALOG)
    expect(out[0].family).toBe('Bebas Neue')
  })

  it('fuzzy-matches a partial name to the catalog family', () => {
    const out = groundSuggestions([{ family: 'DM Serif', reason: 'elegant' }], CATALOG)
    expect(out[0].family).toBe('DM Serif Display')
  })

  it('drops families that do not exist in the catalog', () => {
    const out = groundSuggestions([
      { family: 'Helvetica Neue', reason: 'classic' },
      { family: 'Roboto', reason: 'clean' },
    ], CATALOG)
    expect(out.map(s => s.family)).toEqual(['Roboto'])
  })

  it('dedupes when two suggestions ground to the same family', () => {
    const out = groundSuggestions([
      { family: 'Playfair Display', reason: 'a' },
      { family: 'playfair  display', reason: 'b' },
    ], CATALOG)
    expect(out).toHaveLength(1)
    expect(out[0].family).toBe('Playfair Display')
  })

  it('ignores malformed suggestion entries', () => {
    const out = groundSuggestions([
      { family: '', reason: 'x' } as any,
      null as any,
      { reason: 'no family' } as any,
      { family: 'Roboto', reason: 'ok' },
    ], CATALOG)
    expect(out.map(s => s.family)).toEqual(['Roboto'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- font-match`
Expected: FAIL — cannot resolve `~~/server/utils/fontMatch` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `frontend/server/utils/fontMatch.ts`:

```typescript
/**
 * Pure grounding of LLM-suggested font names against the real Google catalog.
 * The model names plausible families that may not exist or may be spelled
 * differently; we map each to a real catalog entry (canonical spelling + the
 * catalog's category) and drop anything we can't match. No network, no Vue —
 * unit-tested in tests/unit/font-match.unit.spec.ts.
 */
export interface RawSuggestion { family: string; reason: string }
export interface CatalogEntry { family: string; category: string }
export interface GroundedSuggestion { family: string; reason: string; category: string }

export function normalizeFamily(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function groundSuggestions(
  raw: RawSuggestion[],
  catalog: CatalogEntry[],
): GroundedSuggestion[] {
  // Exact-normalized lookup for the common case.
  const byNorm = new Map<string, CatalogEntry>()
  for (const c of catalog) byNorm.set(normalizeFamily(c.family), c)

  const out: GroundedSuggestion[] = []
  const seen = new Set<string>()

  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.family !== 'string') continue
    const norm = normalizeFamily(r.family)
    if (!norm) continue

    let match = byNorm.get(norm)

    // Prefix match either direction (e.g. "DM Serif" -> "DM Serif Display").
    if (!match) {
      const cands = catalog.filter(c => {
        const cn = normalizeFamily(c.family)
        return cn.startsWith(norm) || norm.startsWith(cn)
      })
      match = shortest(cands)
    }

    // Token-subset fallback: every word of the suggestion appears in the family.
    if (!match) {
      const tokens = norm.split(' ')
      const cands = catalog.filter(c => {
        const cn = normalizeFamily(c.family)
        return tokens.every(t => cn.includes(t))
      })
      match = shortest(cands)
    }

    if (!match) {
      console.warn('[font-suggest] dropped ungrounded family:', r.family)
      continue
    }
    if (seen.has(match.family)) continue
    seen.add(match.family)
    out.push({ family: match.family, reason: String(r.reason ?? ''), category: match.category })
  }

  return out
}

function shortest(cands: CatalogEntry[]): CatalogEntry | undefined {
  if (!cands.length) return undefined
  return cands.reduce((a, b) => (b.family.length < a.family.length ? b : a))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- font-match`
Expected: PASS (all cases in `font-match.unit.spec.ts`).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/utils/fontMatch.ts frontend/tests/unit/font-match.unit.spec.ts
git commit -m "feat(fonts): pure grounding of suggested families to real catalog"
```

---

### Task 3: The `/api/font-suggest` route

**Files:**
- Create: `frontend/server/api/font-suggest.post.ts`

(No unit test — this is the Anthropic + grounding shell, mirroring the untested `pipeline-suggest.post.ts`. Its testable core, `groundSuggestions`, is covered by Task 2. Verified manually in Step 2.)

- [ ] **Step 1: Write the route**

Create `frontend/server/api/font-suggest.post.ts`:

```typescript
// Map a free-text description to real Google Fonts families.
// Sibling of pipeline-suggest.post.ts: raw fetch, user-supplied Anthropic key,
// Haiku + structured outputs. We ground the model's names against the real
// Google catalog (server/utils/fontMatch) so hallucinated families never ship.
import { getGoogleCatalog } from '../utils/googleCatalog'
import { groundSuggestions } from '../utils/fontMatch'

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          family: { type: 'string', description: 'Exact Google Fonts family name' },
          reason: { type: 'string', description: 'Max ~12 words on why it fits the description' },
        },
        required: ['family', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['suggestions'],
  additionalProperties: false,
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { apiKey, query } = body || {}

  if (!apiKey || typeof apiKey !== 'string') {
    throw createError({ statusCode: 400, message: 'Missing Anthropic API key' })
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    throw createError({ statusCode: 400, message: 'Missing description' })
  }
  const description = query.trim().slice(0, 200)

  const prompt = `You recommend fonts. The user describes the look they want; suggest up to 8 real Google Fonts families that match.

USER DESCRIPTION: "${description}"

Rules:
- Only real Google Fonts families. Spell each exactly as Google Fonts spells it.
- Favor variety over near-duplicates of the same family.
- "reason" is at most ~12 words on why that font fits the description.`

  let suggestions: { family: string; reason: string }[]
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[font-suggest] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      const message = errBody?.error?.message || `Anthropic API error: ${res.status}`
      throw createError({ statusCode: res.status, message })
    }

    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    if (!text) throw createError({ statusCode: 502, message: 'Empty response from Claude' })
    suggestions = JSON.parse(text).suggestions
  }
  catch (err: any) {
    if (err.statusCode) throw err
    if (err instanceof SyntaxError) throw createError({ statusCode: 502, message: 'Claude returned invalid JSON' })
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }

  const catalog = await getGoogleCatalog()
  return { suggestions: groundSuggestions(suggestions, catalog) }
})
```

- [ ] **Step 2: Manually verify the route end to end**

Start the dev server (`npm run dev`). With a real Anthropic key in `$KEY`, run:

```bash
curl -s http://localhost:3000/api/font-suggest \
  -H 'content-type: application/json' \
  -d "{\"apiKey\":\"$KEY\",\"query\":\"fonts like the New York Knicks logo\"}"
```

Expected: JSON `{"suggestions":[{"family":"...","reason":"...","category":"..."}, ...]}` with real Google family names (e.g. condensed athletic faces). Confirm every `family` is a real catalog name (cross-check against `/api/google-fonts` if unsure). Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add frontend/server/api/font-suggest.post.ts
git commit -m "feat(fonts): /api/font-suggest route (Haiku + catalog grounding)"
```

---

### Task 4: Pure request/error helper (`fontSuggest.ts`) — TDD

**Files:**
- Create: `frontend/tests/unit/font-suggest-request.unit.spec.ts`
- Create: `frontend/app/lib/fontSuggest.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/font-suggest-request.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSuggestRequest, STANDARD_KEY_ERROR } from '~/lib/fontSuggest'

describe('buildSuggestRequest', () => {
  it('returns an error when the API key is missing', () => {
    const r = buildSuggestRequest(null, 'elegant serif')
    expect(r).toEqual({ ok: false, error: STANDARD_KEY_ERROR })
  })

  it('returns an error when the API key is blank', () => {
    expect(buildSuggestRequest('   ', 'elegant serif')).toEqual({ ok: false, error: STANDARD_KEY_ERROR })
  })

  it('returns ok:false with no error for a blank query (nothing to do)', () => {
    const r = buildSuggestRequest('sk-key', '   ')
    expect(r.ok).toBe(false)
    expect((r as any).error).toBeUndefined()
  })

  it('builds a trimmed request body when key and query are present', () => {
    const r = buildSuggestRequest('sk-key', '  knicks logo  ')
    expect(r).toEqual({ ok: true, body: { apiKey: 'sk-key', query: 'knicks logo' } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- font-suggest-request`
Expected: FAIL — cannot resolve `~/lib/fontSuggest`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/fontSuggest.ts`:

```typescript
/**
 * Pure helpers for the font-suggestion composable. Kept Vue-free so the
 * key/error decision is unit-tested without the Nuxt runtime.
 */
export interface FontSuggestion { family: string; reason: string; category: string }

export const STANDARD_KEY_ERROR = 'No Anthropic API key set. Add your key in Settings → AI.'

export type SuggestRequest =
  | { ok: true; body: { apiKey: string; query: string } }
  | { ok: false; error?: string }

/** Decide whether/how to call /api/font-suggest. No key -> error; blank query -> silent no-op. */
export function buildSuggestRequest(apiKey: string | null | undefined, query: string): SuggestRequest {
  if (!apiKey || !apiKey.trim()) return { ok: false, error: STANDARD_KEY_ERROR }
  const q = (query ?? '').trim()
  if (!q) return { ok: false }
  return { ok: true, body: { apiKey, query: q } }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- font-suggest-request`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/fontSuggest.ts frontend/tests/unit/font-suggest-request.unit.spec.ts
git commit -m "feat(fonts): pure request/error helper for font suggestions"
```

---

### Task 5: The `useFontSuggest` composable

**Files:**
- Create: `frontend/app/composables/useFontSuggest.ts`

(No unit test — its decision logic is `buildSuggestRequest` from Task 4; the rest is `$fetch` + refs verified in-app at Task 6/7. The repo has no `$fetch`-mock precedent.)

- [ ] **Step 1: Write the composable**

Create `frontend/app/composables/useFontSuggest.ts`:

```typescript
import { buildSuggestRequest, STANDARD_KEY_ERROR, type FontSuggestion } from '~/lib/fontSuggest'

/**
 * Drives the ✨ "describe a font" search shared by both font pickers. Reads the
 * Anthropic key from local settings, POSTs to /api/font-suggest, and exposes the
 * grounded suggestions. Failures are non-fatal — the picker's literal search
 * keeps working.
 */
export function useFontSuggest() {
  const { getLocalSetting } = useLocalSettings()

  const suggestions = ref<FontSuggestion[]>([])
  const loading = ref(false)
  const error = ref('')
  const hasRun = ref(false)

  function clear() {
    suggestions.value = []
    error.value = ''
    hasRun.value = false
  }

  async function suggest(query: string) {
    const apiKey = getLocalSetting('Sailor.AI.AnthropicApiKey')
    const req = buildSuggestRequest(apiKey, query)
    if (!req.ok) {
      error.value = req.error ?? ''
      if (req.error) { suggestions.value = []; hasRun.value = true }
      return
    }

    loading.value = true
    error.value = ''
    hasRun.value = true
    try {
      const data = await $fetch<{ suggestions: FontSuggestion[] }>('/api/font-suggest', {
        method: 'POST',
        body: req.body,
      })
      suggestions.value = data.suggestions ?? []
    }
    catch (e: any) {
      suggestions.value = []
      error.value = e?.data?.message || e?.message || 'Could not get suggestions.'
    }
    finally {
      loading.value = false
    }
  }

  return { suggestions, loading, error, hasRun, suggest, clear, STANDARD_KEY_ERROR }
}
```

- [ ] **Step 2: Typecheck the new code**

Run: `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i fontSuggest || echo "no fontSuggest type errors"`
Expected: `no fontSuggest type errors` (other pre-existing project errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/composables/useFontSuggest.ts
git commit -m "feat(fonts): useFontSuggest composable"
```

---

### Task 6: Wire the ✨ Suggested section into the template picker

**Files:**
- Modify: `frontend/app/components/templates/FontPicker.vue`

- [ ] **Step 1: Add imports, composable, and Enter/✨ handler**

In the `<script setup>` of `frontend/app/components/templates/FontPicker.vue`, add the Sparkles icon to the existing lucide import and wire the composable. Change the import line:

```typescript
import { Check, ChevronDown, Search, X as XIcon } from 'lucide-vue-next'
```
to:
```typescript
import { Check, ChevronDown, Search, Sparkles, X as XIcon } from 'lucide-vue-next'
```

Then, immediately after the line `const { ensure: ensureGoogleFont } = useGoogleFontPreview()`, add:

```typescript
const { suggestions, loading: suggestLoading, error: suggestError, hasRun: suggestRan, suggest, clear: clearSuggest } = useFontSuggest()

function runSuggest() { suggest(search.value) }

// Load the real face for each suggestion so the preview row paints in-face.
watch(suggestions, (list) => { for (const s of list) ensureGoogleFont(s.family) })

// A fresh search query invalidates a prior suggestion run.
watch(search, () => { if (suggestRan.value) clearSuggest() })
```

- [ ] **Step 2: Make Enter trigger suggest**

In the existing `onKeydown` function, replace the `Enter` branch:

```typescript
  if (e.key === 'Enter') {
    e.preventDefault()
    if (filtered.value.length === 1) { select(filtered.value[0].name); return }
    if (showCustomApply.value) select(search.value)
  }
```
with:
```typescript
  if (e.key === 'Enter') {
    e.preventDefault()
    runSuggest()
  }
```

- [ ] **Step 3: Add the ✨ button to the search bar**

In the template, the search bar row ends with the clear button inside `<div class="px-2.5 py-2 flex items-center gap-2 border-b border-white/[0.06]">`. Immediately after the closing `</button>` of the `v-if="search"` clear button (i.e. right before that row's closing `</div>`), add:

```html
        <button
          type="button"
          tabindex="-1"
          title="Suggest fonts from a description"
          class="shrink-0 text-white/40 hover:text-white/90 cursor-pointer transition-colors disabled:opacity-40"
          :disabled="suggestLoading"
          @click="runSuggest"
        >
          <Sparkles class="size-3.5" />
        </button>
```

- [ ] **Step 4: Add the Suggested section at the top of the scroll list**

Inside `<div class="overflow-y-auto" style="max-height: 280px;">`, as the FIRST child (before the empty-state `v-if="filtered.length === 0"` block), add:

```html
        <!-- ✨ Suggested (from a description) -->
        <template v-if="suggestLoading || suggestError || suggestions.length || suggestRan">
          <div class="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-white/40 font-medium select-none flex items-center gap-1.5">
            <Sparkles class="size-2.5" /> Suggested
          </div>
          <div v-if="suggestLoading" class="px-3 py-2 text-[12px] text-white/40 italic">Finding fonts…</div>
          <div v-else-if="suggestError" class="px-3 py-2 text-[12px] text-white/40">{{ suggestError }}</div>
          <div v-else-if="!suggestions.length" class="px-3 py-2 text-[12px] text-white/40">
            No matches — try describing the style differently.
          </div>
          <button
            v-for="s in suggestions"
            :key="'s' + s.family"
            type="button"
            class="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/[0.05] transition-colors cursor-pointer"
            :class="s.family === modelValue ? 'bg-[#96b4ff]/[0.08]' : ''"
            @click="select(s.family)"
          >
            <span class="flex-1 min-w-0 text-left">
              <span class="block text-[15px] text-white leading-tight truncate" :style="{ fontFamily: s.family }">{{ s.family }}</span>
              <span class="block text-[10px] text-white/35 leading-tight truncate">{{ s.reason }}</span>
            </span>
            <span class="text-[9px] text-white/20 uppercase tracking-wider shrink-0 select-none">{{ s.category }}</span>
            <Check v-if="s.family === modelValue" class="size-3 text-[#96b4ff] shrink-0" />
          </button>
          <div class="mx-3 my-1 border-t border-white/[0.05]" />
        </template>
```

- [ ] **Step 5: Verify in-app**

Run `npm run dev`. Open a template/style property that uses this picker. Type "elegant wedding serif", click ✨ (and separately test pressing Enter). Confirm: a ✨ Suggested section appears above Curated/Google, each row renders in its own font face with a reason line, and clicking one applies it. With no Anthropic key set, confirm the section shows "No Anthropic API key set. Add your key in Settings → AI." Capture a screenshot for the user. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/templates/FontPicker.vue
git commit -m "feat(fonts): ✨ describe-to-suggest section in template font picker"
```

---

### Task 7: Wire the ✨ Suggested section into the canvas widget picker

**Files:**
- Modify: `frontend/app/components/vue-canvas/widgets/FontPicker.vue`

This picker emits a `pick` carrying a full `GoogleFont`, so a suggestion click must resolve the family back to a loaded catalog entry.

- [ ] **Step 1: Add the composable, handlers, and catalog lookup**

In `<script setup>`, after the line `const loading = ref(false)`, add:

```typescript
const { suggestions, loading: suggestLoading, error: suggestError, hasRun: suggestRan, suggest, clear: clearSuggest } = useFontSuggest()

function ensureCatalog() {
  if (catalog.value.length || loading.value) return
  loading.value = true
  loadGoogleCatalog().then(list => { catalog.value = list }).finally(() => { loading.value = false })
}

function runSuggest() {
  ensureCatalog()           // suggestions resolve against the catalog
  suggest(query.value)
}

function pickSuggestion(family: string) {
  const font = catalog.value.find(f => f.family === family)
  if (font) pickGoogle(font)   // closes the panel via pickGoogle
}

// Invalidate suggestions when the query changes.
watch(query, () => { if (suggestRan.value) clearSuggest() })
```

- [ ] **Step 2: Trigger suggest on Enter in the search input**

In the template, the search input is `<input ref="searchEl" v-model="query" class="fp__search" placeholder="Search fonts…" />`. Replace it with one that handles Enter:

```html
      <input
        ref="searchEl"
        v-model="query"
        class="fp__search"
        placeholder="Search or describe fonts…"
        @keydown.enter.prevent="runSuggest"
      />
```

- [ ] **Step 3: Add a ✨ button next to the search input**

Wrap the search input + a new button in a row. Replace the input block from Step 2 with:

```html
      <div class="fp__searchrow">
        <input
          ref="searchEl"
          v-model="query"
          class="fp__search"
          placeholder="Search or describe fonts…"
          @keydown.enter.prevent="runSuggest"
        />
        <button type="button" class="fp__sparkle" title="Suggest fonts from a description" :disabled="suggestLoading" @click="runSuggest">✨</button>
      </div>
```

- [ ] **Step 4: Add the Suggested section at the top of the list**

Inside `<div class="fp__list">`, as the FIRST child (before the `<template v-if="featured.length">` block), add:

```html
        <template v-if="suggestLoading || suggestError || suggestions.length || suggestRan">
          <div class="fp__group">✨ Suggested</div>
          <div v-if="suggestLoading" class="fp__more">Finding fonts…</div>
          <div v-else-if="suggestError" class="fp__more">{{ suggestError }}</div>
          <div v-else-if="!suggestions.length" class="fp__more">No matches — try describing the style differently.</div>
          <button
            v-for="s in suggestions"
            :key="'s' + s.family"
            type="button"
            class="fp__row"
            :class="{ 'fp__row--sel': selectedKey === 'goog:' + s.family }"
            @click="pickSuggestion(s.family)"
          >
            <span class="fp__row-name" :style="{ fontFamily: s.family }">{{ s.family }}</span>
            <span class="fp__row-meta">{{ s.reason }}</span>
          </button>
        </template>
```

- [ ] **Step 5: Add styles for the search row and sparkle button**

In the `<style scoped>` block, after the `.fp__search:focus { … }` rule, add:

```css
.fp__searchrow { display: flex; align-items: center; gap: 6px; }
.fp__searchrow .fp__search { flex: 1; }
.fp__sparkle {
  flex-shrink: 0;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 4px 7px;
  font-size: 12px;
  cursor: pointer;
}
.fp__sparkle:hover { border-color: rgba(255,255,255,0.25); }
.fp__sparkle:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 6: Verify in-app**

Run `npm run dev`, open the Space Type Font Playground widget on the canvas, open the font picker. Type "fonts like the New York Knicks logo", click ✨ (and test Enter). Confirm the ✨ Suggested section appears above Featured, rows render in-face with the reason as the meta line, and clicking one selects that font in the playground. Screenshot for the user. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/FontPicker.vue
git commit -m "feat(fonts): ✨ describe-to-suggest section in canvas font picker"
```

---

### Task 8: Full test + typecheck pass

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: PASS, including `font-match` and `font-suggest-request`. No previously-passing test regressed.

- [ ] **Step 2: Final commit if anything was touched**

If Step 1 required a fix, commit it:

```bash
git add -A
git commit -m "test(fonts): green unit suite for font suggestions"
```

---

## Self-Review Notes

- **Spec coverage:** shared catalog util (Task 1), grounding (Task 2), `/api/font-suggest` (Task 3), key/error helper (Task 4), composable (Task 5), both pickers with ✨ button + Enter + in-face preview + reason line (Tasks 6–7), error/no-key/empty states (Tasks 5–7), unit tests for grounding + request helper (Tasks 2, 4). All present.
- **Trigger decision:** template picker Enter now runs suggest (per the spec's resolved default), replacing the old single-match/custom-apply shortcuts; custom-apply remains reachable via its footer "Use" button.
- **No-purple rule:** new ✨ affordances use neutral white-opacity; the only accent colors reused (`#96b4ff` selection tint in the template picker, indigo selection tint in the widget) are pre-existing in those files, not added here.
- **Type consistency:** `FontSuggestion {family,reason,category}` (lib/fontSuggest.ts) matches the route's grounded output and `GroundedSuggestion` (fontMatch.ts); composable returns `suggestions/loading/error/hasRun/suggest/clear`, consumed verbatim in both pickers.
