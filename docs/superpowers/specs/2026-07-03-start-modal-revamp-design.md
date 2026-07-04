# Start Modal Revamp — capability showcase (first pass)

**Date:** 2026-07-03
**Status:** Approved direction, pending spec review
**Scope:** Frontend only. Revamp `StartProjectModal.vue` into the taxonomy's front door. First pass deliberately minimal: hero tier + studios row, nothing else.

## 1. Purpose & decided constraints

The modal's job is **capability showcase, not intent collection**. Decided in design discussion:

- **No prompt field.** A prompt is untrustworthy until the user understands what the product can do (blank-page problem; recognition over recall). The canvas agent bar remains the prompt surface, discovered after orientation.
- **Shows on every fresh blank project** (today's behavior), with Skip / Escape / backdrop-click unchanged as the one-keypress escape valve. No frequency gating.
- **First pass = hero tier + "Craft it by hand" only.** No search, no outcome tabs, no long-tail browse (that's the Actions panel's job), no surfaces row, no upload tile — all deliberately deferred to avoid overwhelm. The modal must fit without scrolling.

## 2. Layout

Top to bottom inside the existing modal shell (backdrop, panel, close X, Escape handling all unchanged):

1. **Headline** — replace "What do you want to make? / Pick a starting point…" with copy that no longer collides with the Add menu's "starting points" vocabulary. Headline: **"What do you want to make?"** (keep). Subline: **"Pick an action — or skip and build freely."**
2. **Hero tier** — 8 action cards, 2 rows × 4, curated by flattening `HERO_BY_DOMAIN` with per-domain caps (image 3, video 2, audio 2, 3d 1):
   - Generate an image · Generate an image with your LoRA · Edit an image (image)
   - Generate a video · Sync lips to audio (video)
   - Generate speech · Generate music (audio)
   - Generate a 3D model (3d)
   Card anatomy identical to today's: use-case icon (`getGeneratorIcon`), verb as title, model subline, brand chip, "from an image/video" hint when the entry has a `source`.
3. **"Craft it by hand"** — labeled row of 6 studio tiles mirroring the Studios toolbar door exactly (same labels, same icons, same flag gating, pastel dot on Shot Director + Lip-Sync): Type · Gradient · Shader · Pattern · Shot Director · Lip-Sync.
4. **Footer** — "Skip — start with a blank canvas" (unchanged).

## 3. Data — `node-capabilities.ts` dies

- `ActionEntry` in `app/data/action-catalog.ts` gains one optional field: `source?: 'image' | 'video' | 'audio' | 'text'` — the upstream artifact this action consumes. Set it on the two hero takes-input entries (`EditImageNode: 'image'`, `LipsyncNode: 'video'`) and on any other entry where it is obviously known; it is additive metadata, safe to extend later.
- The modal renders hero cards from `ACTION_CATALOG` + a small `MODAL_HERO` derivation (flatten `HERO_BY_DOMAIN` with the caps above — a pure function in action-catalog.ts, unit-tested: 8 entries, all exist in catalog).
- The studios row reuses the **same options source as the toolbar door** — export `studiosOptions` from wherever it lives (currently `default.vue`) into a small shared module (e.g. `app/data/studio-options.ts`) so the modal and the toolbar door cannot drift; both import it.
- **Delete `app/data/node-capabilities.ts`** and the modal's `CAPABILITIES`/`OUTPUT_TYPES` imports. Verify no other consumer exists (inventory says the modal is the only one; confirm by grep before deleting).
- No `/object_info` fetch in the modal — everything rendered is statically known. (Prices are therefore not shown on modal cards; acceptable — the Actions panel is the priced surface.)

## 4. Interactions

- **Action card click** — emits what the parent needs to keep today's behavior exactly: drop the action node, and when the entry has `source`, also drop a pre-wired source artifact (the runnable-graph-in-one-click mechanic — preserved verbatim). The emit payload changes shape from `Capability` to `{ nodeType: string; source?: IOType }`; update `onStartModalPick` in `default.vue` accordingly.
- **Studio tile click** — closes the modal and routes through the existing `onLoadOption` handler (nodeType drop or `special: 'space-type'` / `'slate-gallery'`), identical to the Studios door. No new placement code paths.
- **Skip / Escape / backdrop** — unchanged.

## 5. Testing

- Unit (vitest, extend `action-catalog.unit.spec.ts`): `MODAL_HERO` returns 8 entries, all present in `ACTION_CATALOG`, per-domain caps respected; every `MODAL_HERO` entry with intent ≠ 'create' has a `source`.
- e2e (extend or sibling of `tests/generators.spec.ts` patterns): fresh project → modal shows hero titles + "Craft it by hand" row; clicking "Edit an image" lands 2 nodes (action + wired image artifact); clicking "Gradient" lands a GradientStudio node; Skip leaves 0 nodes.

## 6. Deferred (explicitly, for later passes)

- Surfaces row (Frame / Smart Layout / Timeline) and Upload tile.
- Search over the full catalog + outcome tabs (long tail stays in the Actions panel).
- Prompt field / agent handoff — revisit only after users demonstrably form the capability mental model.
- Frequency gating / "Get started" re-summon affordance.
- Live prices on modal cards (needs the shared `/object_info` composable).
