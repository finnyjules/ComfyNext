# Train-style Aesthetic Auto-fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the editable "Aesthetic" field for own-file uploads in the Train-a-style tab, with an "Auto-fill from images" button that produces a Krea-format taste profile (prose paragraph + keyword list) from the uploaded images.

**Architecture:** Reuse the existing `importedAesthetic` ref as the single source of truth (tri-state: `null` = hidden, `''` = visible+blank, non-empty = filled). Extend the existing `/api/cloud-train/aesthetic` Qwen2-VL endpoint to also emit keywords via a new pure parser module. Add a client-side pure assembler that joins prose + keywords into the exact Krea shape. Wire an explicit button in `LoraTrainerSurface.vue`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Nitro server routes (h3), Vitest (`npm run test:unit`), Replicate (Qwen2-VL vision model).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-23-train-style-aesthetic-autofill-design.md`.
- Krea taste-profile format = prose paragraph, then `\n\n`, then keywords joined with `, ` (see `importKreaBoard`, `LoraTrainerSurface.vue:657-662`). Auto-fill output MUST be format-identical.
- `importedAesthetic` stays the single source of truth read by `generateAesthetic()` (`LoraTrainerSurface.vue:1224`), the header `aesthetic ✓` badge, and the sidecar. Do not introduce a parallel state.
- The train-time short-circuit uses a truthiness check (`if (importedAesthetic.value)`), so `''` correctly falls through to silent generation. Do not change it.
- Auto-fill is triggered by an **explicit button only** — never automatically on upload.
- Endpoint response stays backward compatible: existing silent caller reads only `aesthetic`; the new `keywords` field is additive.
- No purple/violet accent colors (project rule). Reuse existing `bg-white/[0.04]` button styling and `Loader2`/`Sparkles`/`Wand` lucide icons already imported at `LoraTrainerSurface.vue:16`.
- Run unit tests with `cd frontend && npm run test:unit`.
- Vitest aliases: `~~` = `frontend/`, `~` = `frontend/app/` (`frontend/vitest.config.ts`). Test files: `frontend/tests/unit/**/*.unit.spec.ts`.
- Pure helpers must live in plain modules (NOT `*.post.ts`), because importing a `defineEventHandler` file under the vitest node env throws (no Nuxt globals). Mirror the `server/api/krea/parse.ts` pattern.

---

### Task 1: Server-side aesthetic-output parser

Split the model-output parsing into a pure, testable module. The Qwen model will be prompted (Task 2) to emit a prose paragraph followed by a single `Keywords: a, b, c` line. This parser turns that raw text into `{ aesthetic, keywords }`.

**Files:**
- Create: `frontend/server/api/cloud-train/aesthetic-parse.ts`
- Test: `frontend/tests/unit/aesthetic-parse.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `cleanProfile(text: string): string` — collapse whitespace, strip surrounding quotes/space, cap at 600 chars. (Moved verbatim from `aesthetic.post.ts`.)
  - `parseAestheticOutput(raw: string): { aesthetic: string; keywords: string[] }` — split the raw model text on the first case-insensitive `Keywords:` label. Everything before → `cleanProfile`'d prose. The label's line → comma-split keywords: trimmed, empties dropped, case-insensitively de-duplicated (first spelling wins), capped at 12. If no `Keywords:` label is present, `keywords` is `[]` and the whole text is the prose.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/aesthetic-parse.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { parseAestheticOutput, cleanProfile } from '~~/server/api/cloud-train/aesthetic-parse'

describe('cleanProfile', () => {
  it('collapses whitespace and strips wrapping quotes', () => {
    expect(cleanProfile('  "Moody  and\n  grainy."  ')).toBe('Moody and grainy.')
  })
})

describe('parseAestheticOutput', () => {
  it('splits prose from a Keywords line', () => {
    const raw = 'Soft grainy film light with a muted palette.\nKeywords: grainy, muted palette, soft light'
    const r = parseAestheticOutput(raw)
    expect(r.aesthetic).toBe('Soft grainy film light with a muted palette.')
    expect(r.keywords).toEqual(['grainy', 'muted palette', 'soft light'])
  })

  it('is case-insensitive on the label and trims/drops empties', () => {
    const raw = 'Prose here.\n\nkeywords:  teal ,, warm grain ,  '
    const r = parseAestheticOutput(raw)
    expect(r.aesthetic).toBe('Prose here.')
    expect(r.keywords).toEqual(['teal', 'warm grain'])
  })

  it('de-duplicates keywords case-insensitively, first spelling wins', () => {
    const r = parseAestheticOutput('P.\nKeywords: Grain, grain, GRAIN, teal')
    expect(r.keywords).toEqual(['Grain', 'teal'])
  })

  it('returns empty keywords when no Keywords line is present', () => {
    const r = parseAestheticOutput('Just a flowing paragraph with no list.')
    expect(r.aesthetic).toBe('Just a flowing paragraph with no list.')
    expect(r.keywords).toEqual([])
  })

  it('caps keywords at 12', () => {
    const list = Array.from({ length: 20 }, (_, i) => `k${i}`).join(', ')
    const r = parseAestheticOutput(`P.\nKeywords: ${list}`)
    expect(r.keywords).toHaveLength(12)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- aesthetic-parse`
Expected: FAIL — cannot resolve `~~/server/api/cloud-train/aesthetic-parse`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/server/api/cloud-train/aesthetic-parse.ts

/** Collapse whitespace, strip wrapping quotes/space, hard-cap length.
 *  It's a prompt prefix, not an essay. */
export function cleanProfile(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 600)
}

/** Parse the vision model's output into a Krea-shaped taste profile:
 *  a prose paragraph plus a list of short style keywords. The model is
 *  prompted to write the paragraph, then a single `Keywords: a, b, c` line. */
export function parseAestheticOutput(
  raw: string,
): { aesthetic: string; keywords: string[] } {
  const m = raw.match(/keywords\s*:/i)
  if (!m || m.index === undefined) {
    return { aesthetic: cleanProfile(raw), keywords: [] }
  }
  const prose = raw.slice(0, m.index)
  const after = raw.slice(m.index + m[0].length)
  // Keywords sit on the label's own line — stop at the first newline.
  const line = after.split(/\r?\n/)[0] ?? ''
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const part of line.split(',')) {
    const kw = part.trim()
    if (!kw) continue
    const key = kw.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    keywords.push(kw)
    if (keywords.length >= 12) break
  }
  return { aesthetic: cleanProfile(prose), keywords }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- aesthetic-parse`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/api/cloud-train/aesthetic-parse.ts frontend/tests/unit/aesthetic-parse.unit.spec.ts
git commit -m "feat(train-style): pure parser for aesthetic prose + keywords"
```

---

### Task 2: Wire the endpoint to emit keywords

Update the Qwen prompt to request a `Keywords:` line, replace the inline `cleanProfile` + raw-join with the new parser, and return `{ aesthetic, keywords }`.

**Files:**
- Modify: `frontend/server/api/cloud-train/aesthetic.post.ts`

**Interfaces:**
- Consumes: `parseAestheticOutput`, `cleanProfile` from Task 1.
- Produces: `POST /api/cloud-train/aesthetic` now returns `{ aesthetic: string; keywords: string[] }`.

- [ ] **Step 1: Replace the inline `cleanProfile` with an import**

Delete the local `cleanProfile` function (currently `aesthetic.post.ts:34-40`) and add at the top of the file (below the existing top comment block, before `QWEN_MODEL`):

```ts
import { parseAestheticOutput } from './aesthetic-parse'
```

- [ ] **Step 2: Update the prompt to request keywords**

Replace `PROFILE_PROMPT` (`aesthetic.post.ts:25-32`) with:

```ts
const PROFILE_PROMPT = [
  'You are an art director writing a reusable STYLE / aesthetic for an image set.',
  'Describe ONLY the shared visual aesthetic: film grain, lighting, color palette,',
  'contrast, mood, texture, focus/blur, and composition treatment.',
  'Do NOT name or describe the specific subjects, people, animals, or objects —',
  'only the visual style and treatment, as if writing reusable gallery wall text.',
  'First write 2–4 sentences, about 60 words, as one flowing evocative paragraph.',
  'Then, on a new line, write "Keywords:" followed by 6–10 short style descriptors',
  '(palette, texture, lighting, and mood terms — never subjects), comma-separated.',
].join(' ')
```

- [ ] **Step 3: Use the parser for the response**

Replace the output-handling block (currently `aesthetic.post.ts:96-103`, from the `// Qwen returns…` comment through `return { aesthetic }`) with:

```ts
  // Qwen returns the text as an array of token strings (or occasionally a string).
  const raw = Array.isArray(pred.output) ? pred.output.join('') : String(pred.output ?? '')
  const { aesthetic, keywords } = parseAestheticOutput(raw)
  if (!aesthetic) {
    throw createError({ statusCode: 502, message: 'Aesthetic generation returned empty text' })
  }

  return { aesthetic, keywords }
```

- [ ] **Step 4: Type-check the server file**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i aesthetic || echo "no aesthetic type errors"`
Expected: `no aesthetic type errors` (the file compiles; `cleanProfile` is no longer referenced locally and `parseAestheticOutput` resolves).

- [ ] **Step 5: Commit**

```bash
git add frontend/server/api/cloud-train/aesthetic.post.ts
git commit -m "feat(train-style): aesthetic endpoint returns prose + keywords"
```

---

### Task 3: Client-side Krea-format assembler

A pure helper that joins a prose paragraph and a keyword list into the exact Krea shape. Keep it shuffle-free for deterministic testing — the caller shuffles before passing keywords in.

**Files:**
- Create: `frontend/app/lib/lora/aesthetic.ts`
- Test: `frontend/tests/unit/lora-aesthetic-assemble.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `assembleAesthetic(prose: string, keywords: string[]): string` — returns `prose` trimmed; if `keywords` is non-empty, appends `\n\n` + `keywords.join(', ')`. Prose-only → just the prose; keywords-only (empty prose) → just the joined keywords (no leading newlines).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/lora-aesthetic-assemble.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { assembleAesthetic } from '~/lib/lora/aesthetic'

describe('assembleAesthetic', () => {
  it('joins prose and keywords in the Krea shape', () => {
    expect(assembleAesthetic('Moody grain.', ['teal', 'soft light']))
      .toBe('Moody grain.\n\nteal, soft light')
  })

  it('returns prose only when there are no keywords', () => {
    expect(assembleAesthetic('  Moody grain.  ', [])).toBe('Moody grain.')
  })

  it('returns keywords only when prose is empty (no leading newlines)', () => {
    expect(assembleAesthetic('', ['teal', 'grain'])).toBe('teal, grain')
  })

  it('preserves the given keyword order (caller shuffles)', () => {
    expect(assembleAesthetic('P.', ['c', 'a', 'b'])).toBe('P.\n\nc, a, b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:unit -- lora-aesthetic-assemble`
Expected: FAIL — cannot resolve `~/lib/lora/aesthetic`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/lora/aesthetic.ts

/** Assemble a prose paragraph + keyword list into the Krea taste-profile shape:
 *  the paragraph, a blank line, then the keywords joined with ", ".
 *  Shuffle-free by design — the caller shuffles keywords before calling so this
 *  stays deterministic and testable. Mirrors importKreaBoard's format. */
export function assembleAesthetic(prose: string, keywords: string[]): string {
  let out = (prose || '').trim()
  const tail = (keywords || []).map((k) => k.trim()).filter(Boolean).join(', ')
  if (tail) out = out ? `${out}\n\n${tail}` : tail
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:unit -- lora-aesthetic-assemble`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/lora/aesthetic.ts frontend/tests/unit/lora-aesthetic-assemble.unit.spec.ts
git commit -m "feat(train-style): pure Krea-format aesthetic assembler"
```

---

### Task 4: Surface the field for own uploads (state + gating)

Make the Aesthetic field appear when the user uploads their own images, tracking whether the aesthetic came from Krea or from images, without disturbing the Krea path.

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue`

**Interfaces:**
- Consumes: `importedAesthetic` ref (`LoraTrainerSurface.vue:533`), `addFiles` (`:468`), `importKreaBoard` (`:610`), `clearDataset` (`:498`).
- Produces: `aestheticSource: Ref<'krea' | 'images' | null>` used by Task 5.

- [ ] **Step 1: Add the source ref**

Immediately after the `importedAesthetic` declaration (`LoraTrainerSurface.vue:533`), add:

```ts
// Where the current aesthetic came from — drives the auto-fill button (images
// only) and the helper copy under the field. null when there's no dataset.
const aestheticSource = ref<'krea' | 'images' | null>(null)
```

- [ ] **Step 2: Initialize the blank field on first own upload**

In `addFiles`, inside the `try` block after the `for (const file of arr) { … }` loop and before `status.value = 'idle'` (around `LoraTrainerSurface.vue:484`), add:

```ts
    // First own upload with no aesthetic yet → reveal the field blank+editable.
    // Krea import sets importedAesthetic to a non-empty string, so this guard
    // (=== null) leaves Krea imports untouched, and won't re-blank on re-uploads.
    if (importedAesthetic.value === null) {
      importedAesthetic.value = ''
      aestheticSource.value = 'images'
    }
```

Note: `importKreaBoard` calls `addFiles(files)` *before* it sets `importedAesthetic` (`:626` then `:662`). That is fine — `addFiles` sets `''`/`'images'`, then Step 3's `importKreaBoard` change overwrites both with the Krea value/source.

- [ ] **Step 3: Tag the Krea path as its source**

In `importKreaBoard`, change the assignment at `LoraTrainerSurface.vue:662`:

```ts
    if (aesthetic) {
      importedAesthetic.value = aesthetic
      aestheticSource.value = 'krea'
    }
```

- [ ] **Step 4: Reset source on dataset clear**

In `clearDataset`, after `importedAesthetic.value = null` (`LoraTrainerSurface.vue:504`), add:

```ts
  aestheticSource.value = null
```

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i LoraTrainerSurface || echo "no LoraTrainerSurface type errors"`
Expected: `no LoraTrainerSurface type errors`. (If `vue-tsc` is unavailable, run `npx tsc --noEmit` and confirm no new errors mention the trainer file.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(train-style): show Aesthetic field for own uploads (source-tracked)"
```

---

### Task 5: Auto-fill button, handler, and source-aware copy

Add the "Auto-fill from images" button and its handler, and make the field's helper copy reflect whether the aesthetic came from Krea or images.

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue`

**Interfaces:**
- Consumes: `assembleAesthetic` (Task 3), `buildStyleMontageDataUrl` (`LoraTrainerSurface.vue:1190`-ish, returns `Promise<string | null>`), `shuffleArray` (`:601`), `images`, `importedAesthetic`, `aestheticSource` (Task 4).
- Produces: `autoFillAesthetic()`, `aestheticGenerating: Ref<boolean>`, `aestheticError: Ref<string | null>`.

- [ ] **Step 1: Import the assembler**

Add near the other `~/lib` imports at the top of the `<script setup>` block in `LoraTrainerSurface.vue` (after the lucide import at `:16`):

```ts
import { assembleAesthetic } from '~/lib/lora/aesthetic'
```

- [ ] **Step 2: Add busy/error refs and the handler**

Immediately after the `generateAesthetic` function (ends `LoraTrainerSurface.vue:1242`), add:

```ts
// Manual, button-triggered aesthetic generation for own-file datasets. Builds a
// montage of the uploaded images, asks the vision endpoint for a Krea-shaped
// taste profile (prose + keywords), and writes it into the editable field.
// Explicit (never auto) so we never fire a paid vision call without a click.
const aestheticGenerating = ref(false)
const aestheticError = ref<string | null>(null)

async function autoFillAesthetic(): Promise<void> {
  if (aestheticGenerating.value || images.value.length === 0) return
  if (
    importedAesthetic.value
    && !window.confirm('Replace the current aesthetic with one generated from your images?')
  ) return
  aestheticGenerating.value = true
  aestheticError.value = null
  try {
    const imageDataUrl = await buildStyleMontageDataUrl()
    if (!imageDataUrl) throw new Error('Could not read the uploaded images.')
    const res = await fetch('/api/cloud-train/aesthetic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl }),
    })
    if (!res.ok) throw new Error(await res.text() || `Failed (${res.status})`)
    const { aesthetic, keywords } = await res.json() as { aesthetic?: string; keywords?: string[] }
    const out = assembleAesthetic(aesthetic || '', shuffleArray(keywords || []))
    if (!out) throw new Error('The model returned an empty aesthetic.')
    importedAesthetic.value = out
    aestheticSource.value = 'images'
  } catch (e: any) {
    aestheticError.value = humanizeError(e?.message ?? String(e))
  } finally {
    aestheticGenerating.value = false
  }
}
```

(`humanizeError` already exists in this component — it's used by `startCloudTraining` at `:1314`.)

- [ ] **Step 3: Add the button to the field's label row and source-aware copy**

Replace the Aesthetic block (`LoraTrainerSurface.vue:2035-2052`, the `<!-- Aesthetic … -->` comment through its closing `</div>`) with:

```vue
          <!-- Aesthetic — shown after a Krea import OR once own images exist -->
          <div v-if="importedAesthetic !== null">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-[12px] font-medium text-white/80">
                Aesthetic
                <span class="text-white/55 font-normal ml-1">added to your prompts</span>
              </label>
              <button
                v-if="aestheticSource === 'images'"
                type="button"
                class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-[11px] text-white/70 hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
                :disabled="aestheticGenerating || images.length === 0"
                @click="autoFillAesthetic"
              >
                <Loader2 v-if="aestheticGenerating" class="size-3.5 animate-spin" />
                <Wand v-else class="size-3.5" />
                {{ aestheticGenerating ? 'Reading images…' : 'Auto-fill from images' }}
              </button>
            </div>
            <p class="text-[11px] text-white/45 mb-2 leading-relaxed">
              A short style description prepended to prompts when you use this style, so generations match the look.
              <template v-if="aestheticSource === 'krea'">
                Imported from your Krea moodboard<span v-if="kreaRework"> and reworded to be original</span> — edit freely.
              </template>
              <template v-else>
                Describe the aesthetic, or auto-fill it from your uploaded images — edit freely.
              </template>
            </p>
            <textarea
              v-model="importedAesthetic"
              rows="4"
              placeholder="Describe the aesthetic — color, texture, light, composition…"
              class="w-full rounded-md bg-white/[0.04] border border-white/[0.08] hover:border-white/15 focus:border-white/25 focus:outline-none px-3 py-2 text-[12.5px] leading-relaxed text-white/85 placeholder:text-white/25 resize-y"
            />
            <p v-if="aestheticError" class="text-[11px] text-rose-300/80 mt-1">{{ aestheticError }}</p>
            <p v-else class="text-[10.5px] text-white/30 mt-1">{{ (importedAesthetic || '').trim().split(/\s+/).filter(Boolean).length }} words</p>
          </div>
```

- [ ] **Step 4: Verify the build compiles and unit suite is green**

Run: `cd frontend && npm run test:unit`
Expected: PASS — full unit suite green (includes Tasks 1 & 3 tests; no regressions).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(train-style): Auto-fill from images button + source-aware copy"
```

---

### Task 6: Manual verification (cannot be unit-tested)

The montage build (WebGL/canvas) and the paid Qwen vision call can't run in unit tests. Verify end-to-end in the app per the project dev workflow.

**Files:** none (verification only).

- [ ] **Step 1: Start the app**

```bash
cd frontend && npm run dev
```

(Backend, if needed: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`.)

- [ ] **Step 2: Verify the field appears for own uploads**

Open the Train-a-style tab. Upload 2+ of your own images. Confirm the **Aesthetic** field now appears, blank, with an **"Auto-fill from images"** button and the "Describe the aesthetic, or auto-fill…" copy.

- [ ] **Step 3: Verify auto-fill produces Krea format**

Click **Auto-fill from images**. Confirm: button shows a spinner + "Reading images…", then the field fills with a prose paragraph, a blank line, and a comma-separated keyword list (same shape as a Krea import). Confirm an error appears inline (not a crash) if the call fails.

- [ ] **Step 4: Verify edit + no double-spend at train time**

Edit the text. Start cloud training. Confirm in the network panel that `/api/cloud-train/aesthetic` is **not** called again during training (the edited `importedAesthetic` short-circuits `generateAesthetic`), and the edited text is what threads into `/status`.

- [ ] **Step 5: Verify Krea path is unchanged**

Clear the dataset, import a Krea moodboard. Confirm the Aesthetic field still shows the Krea import copy, **no** Auto-fill button (source = krea), and the `aesthetic ✓` badge appears as before.

- [ ] **Step 6: Take a screenshot for sign-off**

Capture the field with an auto-filled aesthetic for the user to sign off on the look.

---

## Self-Review Notes

- **Spec coverage:** §1 (surface field / tri-state) → Task 4. §2 (button + handler) → Task 5. §3 (Krea format: prose+keywords) → Tasks 1 (parse), 2 (endpoint), 3 (assemble), 5 (wire). §4 (no double-spend) → unchanged truthiness check, verified in Task 6 Step 4. Out-of-scope items (name/trigger prefill, fallback path) correctly untouched.
- **Type consistency:** endpoint returns `{ aesthetic, keywords }` (Task 2) ↔ consumed as `{ aesthetic?, keywords? }` (Task 5). `assembleAesthetic(prose, keywords)` signature consistent across Tasks 3 & 5. `aestheticSource` `'krea'|'images'|null` consistent across Tasks 4 & 5.
- **Placeholder scan:** none — every code step shows full content.
- **Risk note:** Task 5 Step 3 replaces an exact existing template block; if line numbers have drifted, match on the `<!-- Aesthetic` comment anchor instead.
