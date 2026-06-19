# Describe-to-Suggest Font Search — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Problem

The two font pickers only support literal substring matching on font names. A user
who knows the *vibe* they want — "fonts that look like the New York Knicks logo",
"friendly rounded geometric sans", "1970s disco display" — has no way to find
matching families. They'd have to already know the font's name.

We want a "describe it, get suggestions" search that uses an LLM's world knowledge
to map a free-text description onto real Google Fonts families.

## Decisions (from brainstorming)

- **Approach:** per-query LLM call (not local tags / not precomputed embeddings),
  because queries like "looks like the Knicks logo" require world knowledge that
  only a model carries.
- **Surface:** both pickers — `templates/FontPicker.vue` and
  `vue-canvas/widgets/FontPicker.vue` — via a shared route + composable.
- **Presentation:** a separate ✨ "Suggested" section pinned **above** the normal
  literal-search list. The literal name search is unchanged. Each suggestion row
  shows a live font preview + a one-line "why it fits" reason.
- **Trigger:** explicit — a ✨ button next to the search box, plus pressing Enter
  in the search input. No debounce, no auto-fire, so there are no surprise API
  calls.
- **Model:** Claude Haiku 4.5 with structured JSON output, user's Anthropic key
  from `localStorage` — identical plumbing to `server/api/pipeline-suggest.post.ts`.

## Architecture

```
Picker search box  ──(✨ click / Enter)──►  useFontSuggest(query)
                                               │  reads Anthropic key from localStorage
                                               ▼
                                   POST /api/font-suggest
                                               │  1. Haiku → ~8 {family, reason}
                                               │  2. ground each family against
                                               │     real Google catalog (fuzzy)
                                               │  3. drop misses
                                               ▼
                              { suggestions: [{ family, reason, category }] }
                                               │
                                               ▼
                        Picker renders ✨ Suggested section above literal list
```

### Why the grounding step exists

The model can name plausible families that don't exist in Google Fonts (or aren't
spelled the way Google spells them). Left alone, those would render as broken
rows. The route validates every suggested family against the **real** ~1900-family
Google catalog and keeps only matches, normalizing to the catalog's exact family
name. This is the single most important correctness mechanism in the feature.

## Components

### 1. `frontend/server/utils/googleCatalog.ts` (new)

Extract the catalog-fetch/transform/cache logic currently inline in
`server/api/google-fonts.get.ts` into a reusable server util:

- `getGoogleCatalog(): Promise<GoogleFont[]>` — fetches Google metadata, strips the
  XSSI guard, transforms, caches in-memory for 24h (move the existing `cache`,
  `TTL_MS`, `transform`, `CATEGORY`, `AXIS_ORDER`, `SOURCE` here).
- `GoogleFont` type exported from here.

`server/api/google-fonts.get.ts` becomes a thin handler that calls
`getGoogleCatalog()` and returns `{ fonts, count }`. Behavior unchanged.

### 2. `frontend/server/api/font-suggest.post.ts` (new)

Mirrors `pipeline-suggest.post.ts`:

- **Input:** `{ apiKey: string, query: string }`.
- **Validation:** 400 if `apiKey` or `query` missing/non-string; cap `query` length
  (e.g. 200 chars) to keep the prompt bounded.
- **Prompt:** ask for up to 8 **Google Fonts** family names that match the user's
  description, each with a ≤12-word reason. Instruct: real Google Fonts families
  only; spell them as Google spells them; prefer variety over near-duplicates.
- **Structured output schema:**
  ```
  { suggestions: [ { family: string, reason: string } ] }   // required, additionalProperties:false
  ```
- **Grounding:** load `getGoogleCatalog()`. Build a normalized lookup
  (lowercased, whitespace-collapsed family → catalog entry). For each suggested
  family: exact-normalized match first; if none, a tolerant fuzzy match
  (normalized startsWith / includes, pick shortest catalog family that contains
  all query tokens). Drop unmatched suggestions and `console.warn` them. Dedupe.
- **Output:** `{ suggestions: [{ family, reason, category }] }` where `family` and
  `category` come from the matched **catalog** entry (canonical spelling), `reason`
  from the model. Empty array is a valid success response.
- **Errors:** same shape/handling as pipeline-suggest (surface Anthropic error
  message + status; 502 on empty/invalid JSON; 500 fallback).

### 3. `frontend/app/composables/useFontSuggest.ts` (new)

- Reads the Anthropic key via `useLocalSettings().getLocalSetting('ComfyNext.AI.AnthropicApiKey')`.
- Exposes `{ suggest(query), suggestions, loading, error, clear() }`.
- `suggest`:
  - If no key → set `error` to the standard "No Anthropic API key set. Add your key
    in Settings → AI." message and return (no fetch).
  - If `query.trim()` empty → no-op.
  - Else `loading = true`, `$fetch('/api/font-suggest', { method:'POST', body:{ apiKey, query } })`,
    populate `suggestions`, capture `error` on failure (non-fatal — literal search
    still works).
- `suggestions` typed as `{ family: string; reason: string; category: string }[]`.

### 4. `templates/FontPicker.vue` (edit)

- Add a ✨ button inside the search bar row (right side, next to the clear `X`).
- Wire `useFontSuggest`. On ✨ click **or** Enter in the search box, call
  `suggest(search)`.
- Render a new **✨ Suggested** section at the very top of the scroll list (above
  Brand / Curated / Google), only when there are suggestions, a loading spinner,
  or an error/empty message. Each suggestion row: same row markup as Google rows
  (preview via `:style="{ fontFamily }"`), with the `reason` shown as a small
  dimmed sub-line, and the category badge. Call `ensureGoogleFont(family)` for the
  preview face (reuse the existing `watch(filtered, …)` pattern — add a watcher on
  `suggestions`).
- Clicking a suggestion calls the existing `select(family)` — no new selection
  path needed.
- Keep the existing Enter behavior (single-match / custom-apply) only when there's
  no description intent; simplest rule: Enter always runs `suggest`, and the
  existing single-filtered-match shortcut stays as a secondary path. (Resolve the
  exact precedence during implementation; default: Enter → suggest.)

### 5. `vue-canvas/widgets/FontPicker.vue` (edit)

- Same ✨ button + section, matching this file's existing styling.
- This picker's `pick` needs a full `GoogleFont` object. On suggestion click:
  ensure `catalog.value` is loaded (it lazy-loads on open already), find the entry
  by family, and call `pickGoogle(font)`. Guard the (unexpected) not-found case by
  ignoring the click. Because the route grounds against the same catalog, found is
  the normal case.
- Render `reason` as the row's secondary text (this file uses `fp__row-meta`; add a
  reason line).

## Styling note (project rule)

Per the user's "no purple accents" rule, the ✨ button and Suggested section must
**not** introduce new violet/indigo. Use neutral white-opacity. The canvas widget
file currently uses indigo (`rgba(129,140,248,…)`) for its existing accents and the
template picker uses blue (`#96b4ff`) — do not add *new* purple; match each file's
existing non-purple treatment, and use a neutral/white treatment for the new ✨
affordance.

## Error / edge handling

| Case | Behavior |
|---|---|
| No Anthropic key | ✨ shows inline "Add your key in Settings → AI"; no fetch |
| Empty query + ✨/Enter | no-op |
| LLM/network failure | non-fatal; `error` shown in the Suggested section; literal list still works |
| 0 valid families after grounding | "No matches — try describing the style differently." |
| Suggested font face not yet loaded | `ensureGoogleFont` / catalog lookup loads it before apply |
| Model returns a non-existent family | dropped during grounding, never rendered |

## Testing

- **Unit — grounding/fuzzy match (pure fn, no network):** real families pass and
  normalize to canonical spelling; invented names dropped; case- and
  whitespace-insensitive; dedupe works.
- **Unit — `useFontSuggest`:** key-missing branch sets the standard error and skips
  fetch; success populates `suggestions`; fetch failure sets `error` non-fatally
  (mock `$fetch`).
- Manual in-app verify (per project rule: visual/UX features get real-app
  confirmation, not unit tests alone) — try "Knicks logo", "elegant wedding serif",
  "brutalist poster" in both pickers.

## Out of scope (YAGNI)

- No caching of suggestions across queries.
- No embeddings / local tag fallback.
- No new settings or UI for choosing the model.
- No changes to how fonts are applied/rendered downstream — suggestions reuse the
  existing `select` / `pickGoogle` paths verbatim.
