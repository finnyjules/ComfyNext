# Character Cast for Shot Director — design spec

**Date:** 2026-07-01
**Status:** Draft for review
**Goal:** person consistency across video generations. A durable **character** (named reference-image set, optionally LoRA-backed) that can be **cast** into Shot Director shots — via canvas wiring or an in-editor picker — so every generation of that person uses the same canonical references.

## Problem

Seedance 2.0 is reference-dominant: identity comes from `identity-lock` reference images, not prompt prose. Today references are attached per-shot by hand, so consistency depends on user discipline — each new ref set is a new identity roll, and nothing persists across shots, sessions, or projects. Trained character LoRAs exist (`kind: 'character'` sidecars, e.g. Millie) but hold **no reference image set** and cannot plug into Seedance at all — LoRAs are an image-model concept.

"Guarantee" is not achievable at the model level; the product goal is: **refs get ~80% consistency, disciplined reuse makes it structural, verification (later phase) catches the tail.** This spec builds the structural-reuse layer.

## Decisions (locked during brainstorm)

| Decision | Choice |
|---|---|
| Entity model | **Reference-first, LoRA optional** — a character is a named ref-image set; `loraName` links a trained LoRA when one exists. No $6 training gate to cast someone |
| Creation paths (all four in v1) | upload photos · one photo → expanded sheet (ideogram-character) · "Save as character" from any image artifact · render refs from a trained LoRA |
| Cast size | **Up to 3 characters per shot** (Seedance total ref budget ≤9 images) |
| Binding semantics | **Live link (Approach 1)** — refs resolve from the registry at compile/generate time; improving a character propagates to every shot that casts them |
| UX | **Both** canvas nodes (Character node + Sheet Builder node wired into Shot Director) **and** in-editor picker — one source of truth, two editors |

## Architecture

```
models/characters/<slug>.json      registry record (refs live in ComfyUI INPUT dir)
frontend/server/api/characters-local.*        CRUD + ref management (mirrors loras-local)
frontend/app/composables/useCharacters.ts     cached registry client
frontend/app/lib/shotdirector/cast.ts         pure: materializeCast, cast clause helpers
CharacterNode.vue                  canvas: library instance, CHARACTER output
CharacterSheetNode.vue             canvas: builder — IMAGE in → sheet → registry + CHARACTER out
ShotDirectorNode                   gains up to 3 CHARACTER inputs; edges sync to sheet.cast
ShotDirectorSurface                gains a Cast section (union view + picker path)
```

### Storage — the zero-Python decision

Reference images are uploaded through the existing `/upload/image` rail and **live in the ComfyUI input dir** (named `char-<slug>_<n>_<ts>.<ext>`); `models/characters/<slug>.json` stores filenames + metadata:

```jsonc
{
  "name": "Reva", "slug": "reva",
  "refImages": ["char-reva_1_1782….png", "…"],   // input-dir filenames, ordered
  "coverIndex": 0,
  "loraName": "Millie.safetensors" | null,        // optional link to models/loras sidecar
  "trigger": "MILLIE" | null,
  "notes": "" ,
  "createdAt": "…", "updatedAt": "…"
}
```

A cast ref is therefore a `'/view?filename=…&type=input'` URL — the exact contract the Shot Director ref chain already speaks (`refUpload.ts` → `parse_view_ref` → `_resolve_local_refs`). **No backend Python changes in this feature.**

### Registry API (`frontend/server/api/`)

- `characters-local.get.ts` — list records + cover thumbnail URLs (served like `lora-cover`).
- `characters-local.post.ts` — create `{ name }` → slugified record.
- `characters-local.patch.ts` — rename / notes / `loraName` link / ref reorder + remove / coverIndex / delete character. Validates slugs and filenames (same hygiene as `loras-local.patch`).
- Ref **adding** needs no new upload endpoint: the client uploads via `/upload/image` first, then PATCHes the filename into `refImages`.

### ShotSheet + compiler (`lib/shotdirector`)

- `types.ts`: `CastMember = { slug: string; name: string; via: 'wire' | 'picker' }`; `ShotSheet.cast: CastMember[]` (default `[]`; `hydrate.ts` defaults it so old sheets are untouched).
- `cast.ts` (new, pure):
  - `materializeCast(sheet, resolved: Record<slug, string[]>): ShotSheet` — injects each member's refs as `identity-lock` image references **ahead of manual refs** (so `[Image1]` = cast member #1), capped at `CAST_REF_CAP = 3` per member; manual refs renumber after. Idempotent (cast-injected refs are tagged so re-materialization replaces, never duplicates).
  - Cap rule: 3 members × 3 refs = 9 = Seedance's `maxRefImages`; when manual image refs exist, cast caps shrink first (members get `floor((9 − manual) / castCount)` each, min 1) and a warning issue explains the squeeze.
- `compile.ts`: when `cast.length > 0`, emit a **cast declaration ahead of the subject sentence**: `Characters: Reva [Image1] [Image2]; Marcus [Image3].` Users refer to members by name in subject/action (refs outweigh prose — existing field-guide posture). Counts toward the word budget.
- `rules.ts` additions (all surfaced like existing issues):
  - error: cast member resolves to zero refs ("add reference photos to Reva")
  - error: duplicate cast slug
  - error: `cast.length > 3`
  - existing `maxRefImages` overflow check covers the total after materialization.

### Dispatch-time resolution (the live link)

`useCharacters()` caches `GET /api/characters-local` (invalidated on a `comfynext:charactersChanged` window event fired by all mutating paths). Both the surface preview and `handleShotDirectorGenerate` resolve `sheet.cast → refImages` through it, then `materializeCast → compileShot → buildFilmShotPatch` — the injected refs ride the existing `/view` → data-URL chain. A deleted character surfaces as the zero-refs compile error, never a silent skip. `buildFilmShotPatch` and everything downstream are unchanged.

### Canvas nodes (frontend-only, like ShotDirector itself)

New `CHARACTER` port type (frontend data type; these nodes never reach the backend graph — same convention as ShotDirector's config-only status).

- **`CharacterNode.vue`** (`nodeType: 'Character'`): a canvas instance of a registry entry. Card = cover, name, ref count, picker button (gallery-modal pattern, mirroring the LoRA picker: node stores `properties.comfynext_characterSlug`). Output: `CHARACTER`.
- **`CharacterSheetNode.vue`** (`nodeType: 'CharacterSheet'`): the builder. Optional `IMAGE` input (wire any artifact) or built-in upload. Card shows the sheet grid with per-shot re-roll (reuses the `character-shot.post.ts` rail + the dataset-builder re-roll pattern). "Expand sheet" runs a new **4-prompt canonical preset** (front / three-quarter / profile / full-body — new small list in `character-shot-scenes.ts`, distinct from the 24 training scenes; ~$0.32 at $0.08/shot, cost shown on the button). For `loraName`-linked characters, a source toggle renders the 4 prompts through the character's private Replicate model instead (trigger word included). Name field + Save writes the registry. Output: `CHARACTER` — castable directly without an intermediate Character node.
- **ShotDirector node**: gains 3 optional `CHARACTER` inputs (fixes the Phase-2 finding that it synthesizes no input ports). An edge-sync handler in `VueNodeCanvas.vue` maps connect/disconnect events to `sheet.cast` entries tagged `via: 'wire'` (resolving the wired node's slug; a Character node with no slug picked yet contributes nothing + card hint).

### Casting UX — one list, two editors

`sheet.cast` is canonical. Wire path: edges add/remove `via:'wire'` entries. Picker path: the surface's new **Cast section** (above References) has "+ Cast" → character picker modal, adding `via:'picker'` entries. The section shows the union: wired chips carry a wire glyph and removing one **removes the edge** (one gesture, both representations update); picked chips remove directly. Cap and zero-ref validation apply to the union. Cast members render with cover avatar + name + resolved-ref count.

"Save as character" on image artifacts: context/footer action → name prompt → POST registry + PATCH the image in as `refImages[0]` (it's already a served file; re-upload to input dir via the existing rail if it isn't `type=input`).

The existing Characters dock panel remains the **library browser** (list, rename, prune, open a character's sheet editor); it lists registry characters, and LoRA characters without a registry record get a one-click "make castable" that creates the record (then refs come from any creation path, including the LoRA bridge).

## Error handling

- All cast errors gate Generate exactly like word-budget errors (buttons disabled, issue shown; canvas handler re-checks and sets `shotError`).
- Registry API validates slugs/filenames; ref files that vanished from the input dir are dropped from the record on read with a warning field (self-healing list), and the Python-side missing-file error (`_local_ref_to_data_url`) remains the last-resort backstop.
- Sheet-expansion failures are per-shot with re-roll (existing dataset-builder pattern); partial sheets are usable.

## Cost affordances

Casting is free (stored files). Money moves only in the Sheet Builder: expansion `~$0.32` (4 × $0.08) and LoRA renders (~$0.03/img) shown on their buttons before click. No auto-spend anywhere — every generation behind an explicit button press.

## Testing

- **Pure (vitest):** `materializeCast` goldens — ordering (cast first, manual renumbered), per-member cap, squeeze rule with manual refs, idempotent re-materialization, zero-ref member passthrough; compiler cast-clause goldens (1 and 3 members); `rules.ts` new cases; `hydrate` back-compat (sheets without `cast`).
- **Registry (vitest, node):** CRUD unit tests mirroring `lora-sidecar.unit.spec.ts` — create/slugify, patch validation, ref reorder/remove, vanished-file self-heal.
- **Canvas (manual + typecheck):** wire → cast entry sync both directions; picker path; union rendering; Generate patch inspection. **Live smoke stops at inspecting the patched FilmShotNode — no real generation without explicit user go-ahead.**
- Existing suites must stay green (shotdirector dispatch/price/composable/refupload; seedance/kling pytest untouched — no Python changes).

## Out of scope (deliberate)

Face-embedding verification and drift detection; last-frame → first-frame chaining; video face-swap repair; more than 3 cast members; per-beat cast activation; wardrobe/prop consistency; auto-migration of all LoRA characters (link is opt-in per character).

## Phasing (single spec, two shippable slices)

1. **Slice A — cast the library:** registry + API + `useCharacters` + cast.ts/compiler/rules + Cast section picker path + "Save as character" + a **minimal sheet editor in the dock panel** (ref grid: upload / remove / reorder — the home of the "upload photos" creation path until the Sheet Builder node lands). Casting works end-to-end without new canvas nodes.
2. **Slice B — canvas citizens:** `CHARACTER` port type, Character node, Sheet Builder node (expansion + LoRA bridge + re-roll — the generation-powered creation paths), ShotDirector inputs + edge sync.
