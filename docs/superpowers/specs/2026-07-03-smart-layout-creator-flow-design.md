# Smart Layout — Creator Flow (in-editor variables, copy assistant, fine grid)

**Date:** 2026-07-03 (overnight session)
**Status:** Design approved in intent by user ("let's fix that please" + two feature asks); details decided autonomously — open questions flagged for morning review.
**Relates to:** `2026-07-03-variables-collections-design.md` (extends §5.1 promote to Smart Layout), Smart Layout v3 spec.

## 1. The problem, in the user's words

Variables in Smart Layout are "mega unintuitive and hidden" — you must know about `{{ props.text_layer_N }}`
tokens and find the drawer's bindings strip. And the editor overall "feels separated from how ad
creators work": writing copy, exploring alternatives, localizing, and precise placement are the
daily loop, and none of them are first-class.

**Design frame:** one loop — *write → make variable → vary/translate (AI) → rows → batch* — plus a
real grid under everything.

## 2. Feature A — one-gesture variables in the Smart Layout editor

- **Gesture:** right-click a text or image element (editor canvas or layers list) →
  **"Turn into variable"**. No tokens to know, no drawer hunting.
- What happens (mirrors the studios' promote exactly, §5.1 of the variables spec):
  1. The element's content is tokenized to the next free socket (`{{ props.text_layer_N }}` /
     `{{ props.image_layer_N }}`).
  2. A Collection is found (wired) or auto-created + VARS-wired to the Smart Layout node.
  3. A column is created — named from the element (its name/role if present, else a slug of the
     current text, else `text_layer_N`) — and the **current content seeds the preview row's cell**,
     so the design renders identically before/after. Binding written to `sailor_varBindings`.
  4. The element shows a **variable chip/badge** in the editor (and its inspector gains a
     "Variable" row: column name, go-to-collection, unbind-freezes-current-text).
- **Bound display:** the editor canvas renders the RESOLVED value (via the same varPreview/props
  path), never the raw token. Editing a bound element's text in the inspector = write-through to
  the preview-row cell (same rule as studio controls).
- Unbind restores literal content (the currently resolved text replaces the token).

## 3. Feature B — copy assistant (LLM) in the text inspector

- **Where:** text element inspector gains a pastel-gradient section (pastel = AI affordance) —
  **"Copy assistant"** with three actions:
  - **Variations** — N alternatives of the current text (tone-preserving).
  - **Write from brief…** — small prompt box ("what should this say? audience? tone?") → N options.
  - **Translate…** — pick languages (multi-select of common ad locales + free text) → one per language.
- **Output UX:** results appear as a option list in the same section; click applies to the element.
- **The rows integration (the point of it all):** when the element is variable-bound, each result
  list offers **"Add all as rows"** — variations/translations append rows to the bound column
  (preview-row values copied, like sweeps/bulk-upload). If the element is NOT yet bound, the button
  reads **"Make variable + add as rows"** and chains Feature A first. Translate-to-5-languages →
  5 rows → Generate 5 = localized campaign in three clicks.
- **Server:** new `POST /api/copy-assist` Nitro route mirroring `/api/vibe`'s pattern (user's
  Anthropic key from the client, `claude-haiku-4-5` — cost-conscious default; brief-mode may use
  the `plan` tier if quality demands, flagged below). Request: `{ apiKey, mode: 'variations' |
  'brief' | 'translate', text, brief?, languages?, count?, context: { otherTexts?, brandTone? } }` →
  `{ options: string[] }` (translate returns `{ options: { language, text }[] }`). Allow-listed in
  `comfyui-proxy.ts` `NITRO_API_PATHS` (known gotcha).
- Length discipline: prompt instructs the model to respect the original's approximate length
  (layout survival); the confirm-y "fits the layout" auto-check is NOT in scope (ties into the
  spec's text-fit/critique future note).

## 4. Feature C — fine grid, immediately

- Smart Layout v3 already PLACES on a fine baseline lattice (`fineGridDims` in
  `shared/template-grid/grid.ts`); it's just not *visible or explicit* while editing.
- **Change:** the editor canvas shows the **fine grid always-on by default** (subtle dots or
  hairline lattice at low opacity, DPI-aware), with element drag/resize snapping to it (if snapping
  exists at coarser granularity today, fine becomes the default; toggle in the toolbar).
- **Columns/rows as an overlay layer** on top of the fine grid (the existing coarse column guides
  become a second toggle), so precise placement and structural alignment coexist — Figma-style.
- Keyboard nudge = one fine cell; Shift-nudge = one coarse column/row (if nudge exists; else add).

## 5. Open questions for morning review (decisions I made; overrule freely)

1. Column naming on promote: element name/role → slug of text → `text_layer_N` fallback. OK?
2. Copy assistant model tier: haiku for all three modes (cost-first). Brief-mode on sonnet instead?
3. Variations count default: 5 (matches sweep default).
4. Fine grid default ON for everyone (vs. remembering a per-user toggle) — I default ON with a
   persisted toggle.
5. Translate language preset list: EN/FR/DE/ES/IT/PT/NL/JA + free-text entry.

## 6. Explicitly out of scope tonight

- Auto-fit/shrink text on overflow (spec §12 text-fit note stands).
- Brief "campaign mode" (multi-element coherent rewrite) — the assistant is per-element v1.
- Image-element AI (that's 2c AI-fill territory).
- Grid redesign of v3 metrics themselves — visibility + snapping only.
