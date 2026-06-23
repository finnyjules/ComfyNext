# Train-a-style: auto-fillable Aesthetic for own-file uploads

**Date:** 2026-06-23
**Status:** Approved design — ready for implementation plan

## Problem

In the "Train a style" tab (`LoraTrainerSurface.vue`), the **Aesthetic** input — a
short style description prepended to prompts so generations match the trained
look — only appears after importing a Krea moodboard. It is gated on
`importedAesthetic !== null`, and `importedAesthetic` is set exclusively by the
Krea import path.

Users who **upload their own images** get no editable Aesthetic field at all.
There *is* a silent train-time generation (`generateAesthetic()` →
`POST /api/cloud-train/aesthetic`, Qwen2-VL) that writes into `cloudAesthetic`,
but it is never surfaced for the user to see or edit, and it produces **prose
only** — not the full Krea taste-profile shape.

We want:

1. The Aesthetic field to appear for own-file uploads too, not just Krea imports.
2. An **auto-fill from the uploaded images**, producing output in the **same
   format as Krea taste profiles** (a flowing prose paragraph + a comma-separated
   keyword list).

## Background: how it works today

- **Field gate** — `LoraTrainerSurface.vue:2036`: `<div v-if="importedAesthetic !== null">`.
- **`importedAesthetic`** — `ref<string | null>(null)` (`LoraTrainerSurface.vue:533`);
  set only inside `importKreaBoard()`.
- **Krea taste-profile format** (`importKreaBoard`, `LoraTrainerSurface.vue:657-662`):
  the prose paragraph, then a blank line, then the board's `positiveKeywords`
  shuffled (`shuffleArray`) and joined with `, `:
  `aesthetic = prose ? `${prose}\n\n${tail}` : tail`.
- **Train-time generation** — `generateAesthetic()` (`LoraTrainerSurface.vue:1221`)
  short-circuits and reuses `importedAesthetic` if it is set
  (`LoraTrainerSurface.vue:1224`); otherwise it builds a montage via
  `buildStyleMontageDataUrl()` and calls `/api/cloud-train/aesthetic`, storing the
  result in `cloudAesthetic`.
- **Vision endpoint** — `server/api/cloud-train/aesthetic.post.ts`: runs
  `lucataco/qwen2-vl-7b-instruct` with `PROFILE_PROMPT` (prose, ~60 words,
  **no keywords**) and returns `{ aesthetic }`.
- Downstream, the aesthetic is threaded into `/api/cloud-train/status` and written
  to the LoRA sidecar, then prepended to prompts when the LoRA is used.

## Design

### 1. Surface the field for own uploads

`importedAesthetic` stays the single source of truth that everything downstream
reads (train-time short-circuit, header `aesthetic ✓` badge, sidecar). We reuse
its tri-state:

- `null` — no dataset yet → field hidden (unchanged).
- `''` — dataset exists, no aesthetic yet → field **visible and blank/editable**.
- non-empty — has an aesthetic (from Krea import, auto-fill, or manual typing).

**Change:** when the user's first **own** file lands, initialize the field if it
is still untouched. In `addFiles()`, after files are added, set
`importedAesthetic.value = ''` **only if** `importedAesthetic.value === null`.
This makes the field appear for own uploads without clobbering a Krea import
(which sets a non-empty value) and without re-blanking on subsequent uploads.

The field gate becomes effectively "show whenever `importedAesthetic !== null`",
which is unchanged in code — the behavior change comes entirely from initializing
it to `''` on own upload. (Krea import continues to overwrite it as before.)

### 2. "Auto-fill from images" button

Add a small button in the Aesthetic field's label row. It is shown for own
uploads (i.e. when the dataset did **not** come from a Krea import — see "source
tracking" below) and there is at least one image.

On click:
1. Set a local `aestheticGenerating` busy flag (spinner on the button, disabled).
2. If `importedAesthetic.value` is non-empty, confirm before overwriting.
3. Build the montage via the existing `buildStyleMontageDataUrl()`.
4. `POST /api/cloud-train/aesthetic` with `{ imageDataUrl }`.
5. Assemble the Krea-format string (see §3) and write it to
   `importedAesthetic.value`.
6. On any failure, surface an inline error near the field and leave existing text
   untouched. Non-fatal — mirrors the existing tolerant style.
7. Clear the busy flag in `finally`.

**Source tracking.** Add a small ref, `aestheticSource: ref<'krea' | 'images' | null>`,
set to `'krea'` in `importKreaBoard()` and `'images'` when the field is first
initialized from an own upload. Used only for:
- showing the auto-fill button (only when `aestheticSource === 'images'`), and
- switching the helper copy under the field:
  - Krea: "Imported from your Krea moodboard … — edit freely."
  - Images: "Generated from your images — edit freely." / before first fill:
    "Describe the aesthetic, or auto-fill it from your images."

### 3. Match the Krea taste-profile format (prose + keywords)

Extend `server/api/cloud-train/aesthetic.post.ts` so its output carries keywords:

- Update the prompt: keep the existing prose instruction, then ask the model to
  follow the paragraph with a single line beginning `Keywords:` listing 6–10
  short style descriptors (palette/texture/lighting/mood terms — **not** subjects),
  comma-separated.
- Parse the model output server-side into `{ aesthetic, keywords }`:
  - `aesthetic` — the prose paragraph (everything before the `Keywords:` line),
    run through the existing `cleanProfile()`.
  - `keywords` — `string[]`, split on commas from the `Keywords:` line, trimmed,
    de-duplicated, empties dropped. If the model omits the line, return `[]`.
- Keep the response backward-compatible: `{ aesthetic, keywords }` (the old
  silent train-time caller reads only `aesthetic`, so it is unaffected).

Client assembles the exact Krea shape, reusing `shuffleArray`:

```
let out = aesthetic.trim()
if (keywords.length) {
  const tail = shuffleArray(keywords).join(', ')
  out = out ? `${out}\n\n${tail}` : tail
}
importedAesthetic.value = out
```

This makes auto-fill output indistinguishable in format from a Krea import.

### 4. No double-spend at train time

`generateAesthetic()` already short-circuits when `importedAesthetic` is set
(`LoraTrainerSurface.vue:1224`). So:

- If the user clicked auto-fill (or typed anything), `importedAesthetic` is
  non-empty → train-time reuses it, **no second Qwen call**.
- If the user left it blank (`''`), train-time falls back to the existing silent
  generation (`buildStyleMontageDataUrl()` → endpoint), exactly as today. Note the
  empty-string check: confirm the short-circuit treats `''` as "not set" so the
  fallback still runs — use a truthiness check (`if (importedAesthetic.value)`),
  which already evaluates `''` as falsy. ✅ No change needed there.

## Touch list

- `frontend/app/components/LoraTrainerSurface.vue`
  - `addFiles()` — initialize `importedAesthetic.value = ''` and
    `aestheticSource.value = 'images'` when first own file lands and field is
    still `null`.
  - `importKreaBoard()` — set `aestheticSource.value = 'krea'`.
  - New refs: `aestheticSource`, `aestheticGenerating`, `aestheticError`.
  - New handler: `autoFillAesthetic()` (montage → endpoint → assemble → assign).
  - Template (around line 2036): add the auto-fill button + spinner + inline
    error, and source-aware helper copy.
- `frontend/server/api/cloud-train/aesthetic.post.ts`
  - Extend prompt to emit a `Keywords:` line.
  - Parse and return `{ aesthetic, keywords }`.
- `frontend/tests/unit/` — unit test for the keyword parse helper (prose+keywords,
  missing keywords line, dedup/trim) and the client-side format assembly.

## Out of scope

- Auto-prefilling the LoRA name / trigger word from images (Krea does this from a
  board title; uploaded images have no title).
- Any change to the silent train-time fallback path beyond returning the new
  `keywords` field (which it ignores).
- Caching/avoiding regeneration across image-set edits — the button is manually
  re-runnable; that is sufficient.

## Testing

- Unit: server-side `Keywords:` parse (present / absent / messy spacing / dupes).
- Unit: client format assembly matches the Krea shape (`prose\n\n` + joined
  keywords; prose-only; keywords-only).
- Manual (cannot be unit-tested — paid vision call + WebGL montage): upload own
  images, confirm field appears blank, click auto-fill, confirm prose+keywords in
  Krea format, edit, train, confirm no second Qwen call and the sidecar carries
  the edited text.
