# House Style Library — Design

**Date:** 2026-07-09
**Status:** Approved design, pending implementation plan
**Companions:** `2026-07-01-arpu-levers-build-order.md` (revenue rationale), the Krea importer (`frontend/server/api/krea/`), the cloud trainer (`LoraTrainerSurface.vue`)

## Premise

Sailor already runs a style factory: ~47 style LoRAs trained from Krea moodboard imports, each with a private Replicate model + stackable `.tar` weights + trigger (and, for newer ones, a taste profile). They live as local sidecars in `models/loras/` — visible only on the dev machine. This project turns them into a **public, house-owned style library organized by use case**: a browsable hub every user gets, seeded with all existing styles, with a repeatable publishing pipeline for the styles that keep arriving.

Strategy (from the brainstorm): house-owned collection + destination surface + richer browsing. Not in scope: use-case-aware auto-suggestions (a later layer on this substrate).

## Decisions made

- **Seed content:** publish ALL ~47 existing style LoRAs (characters excluded). Thumbnail bake acts as the QA gate — entries with weak thumbs get pruned after review.
- **Taxonomy:** use-case **tags** (multi-valued: `poster`, `branding`, `illustration`, `editorial`, `ecomm`, …) are the primary browse dimension. Verticals (Fashion, Architecture, …) are curated tag groups, not exclusive categories. Existing styles are aesthetic-first and tag into multiple use cases.
- **Phase 2 (separate effort):** new house training to fill use-case gaps (Fashion, Architecture) via synthetic-distillation datasets — brief → Seedream/nano-banana dataset (varied subjects, constant look) → curate ~20 → train. Krea boards are a **brief source** for these (taste profile + "make it original" rewrite), not a dataset source.
- **Catalog storage:** a git-committed data file, not a backend. At this scale curation-by-commit is a feature. Schema designed to lift into a server registry later without UI changes.
- **Production tooling:** a dev-only publisher page, since styles keep arriving — publishing must be repeatable, not hand-copied.

## Architecture

Three units, all frontend/Nitro — **zero ComfyUI/Python changes**.

### 1. Catalog data (`frontend/app/data/house-styles.ts`)

```ts
export interface HouseStyle {
  id: string                 // kebab: 'rough-cut-revival'
  label: string              // 'Rough Cut Revival'
  useCases: string[]         // ≥1 tag from USE_CASE_TAGS
  trigger: string
  tasteProfile: string       // dense conditioning block; REQUIRED (backfilled at publish)
  replicateModel: string     // 'owner/model' (version hash stripped) — single-LoRA direct-run path
  weightsUrl: string         // trained_model.tar — multi-lora stacking path
  thumbnails: string[]       // 4 paths under /house-styles/<id>/
  examplePrompts: string[]   // ≥1
  suggestedScale?: number
}
```

- `USE_CASE_TAGS` is a typed union + display metadata (label, icon, order). Vertical groupings are a `VERTICALS: { label, tags[] }[]` overlay.
- Entries are **self-contained** — no dependency on `models/loras/` sidecars (those exist only locally; the catalog must resolve for every user).
- Thumbnails are static assets at `frontend/public/house-styles/<id>/thumb-{1..4}.webp`, committed to git.
- The existing `LORA_LIBRARY` (public HF LoRAs) gains optional `useCases?: string[]` and surfaces as a **Community** tier below house styles in the hub. No removal, no schema break.

### 2. Publisher tool (`frontend/app/pages/dev/style-publisher.vue`, dev-only, prod-stripped like other `/dev` routes)

Reads `/api/loras-local` (styles only), shows publish status per style (already-in-catalog detection by `replicateModel`), and per style runs a 3-step flow:

1. **Backfill + tag** — generate a missing taste profile (existing `taste-profile.post.ts` Qwen endpoint, fed with a fresh sample gen when no dataset montage exists) and assign use-case tags + example prompts.
2. **Bake thumbnails** — 4 generations through the style's own model via the existing LoRA generation path, using **fixed benchmark subjects and seeds shared across ALL styles** (portrait / scene / object-product / typographic-poster) so the hub grid compares apples to apples. ~$0.03–0.12 per image; full 47-style backfill ≈ $6–25 total.
3. **Emit entry** — a dev-only server endpoint writes the thumbs to `public/house-styles/<id>/` and appends/updates the entry in `house-styles.ts` (upsert keyed by `replicateModel`). Publishing = reviewing the git diff and committing.

Benchmark prompts/seeds live in one exported const so re-bakes are reproducible.

### 3. Style Hub (`frontend/app/components/StyleHubModal.vue` on the `CatalogModal` pattern)

- Tabs: use-case tags (grouped by vertical overlay) + **Community** (the HF library re-tagged; falls back to its old categories where untagged).
- Cards: thumbnail-forward; hover cycles the 4 thumbs. Detail pane: all thumbs, taste profile (collapsed), example prompts, suggested scale, **Use style**.
- **Use style** rides existing rails only:
  - Standalone → spawn/prefill `FluxLoRARemoteNode` with `lora_url` = `replicateModel` (the existing `_is_replicate_model_ref` direct-run path), taste profile + trigger into the collapsed Style property (`properties.aesthetic`), prompt left for the user.
  - With a character (from the Characters panel flow) → `FluxMultiLoRARemoteNode`, `lora_b_url` = `weightsUrl`, `scale_b` = `suggestedScale ?? 1.0`.
- Entry points: Styles dock panel header ("Browse library") and a House tab in the node `lora_picker` gallery (`LoraGalleryModal`).

## Testing

- **Unit (vitest):** catalog integrity — unique ids, ≥1 use-case tag from the union, non-empty trigger/tasteProfile/examplePrompts, exactly 4 thumbnails whose files exist on disk, `weightsUrl` matches the multi-lora loader regex (`replicate.delivery/<seg>/<seg>/trained_model.tar`), `replicateModel` has no version hash.
- **Unit:** benchmark-prompt const shape (4 prompts, stable seeds).
- **Browser pass:** hub browse, tag filtering, hover-cycle, Use-style spawning both node types with correct widget/property values (per `feedback_verify_visuals_with_screenshots`, no shipping on unit tests alone).
- **One live paid gen** through a published entry (single-LoRA path) + one stacked (multi-lora) as the final publish sign-off — user-owned.

## Risks & accepted trade-offs

- **Training-data provenance:** existing styles were trained directly on Krea board images (other users' AI generations). The "make it original" rewrite covers names/profiles, and AI-output training data is a common-but-gray posture. **Accepted for the existing catalog**; phase-2 styles use the synthetic-regeneration hygiene step (Krea = brief source only).
- **Single Replicate account:** all house models run under the app's server key — already true for every generation today. Multi-tenant ownership/lifecycle is deferred to the accounts/billing epic (flagged there).
- **Multi-lora warm-container bug** (upstream) applies to stacked use; the shipped rotation+retry mitigation stands. Single-LoRA direct-run is unaffected.
- **Replicate delivery-URL longevity:** `weightsUrl` tars are Replicate CDN artifacts. If one 404s, the style still works single-LoRA (model ref); stacking breaks for that entry. Mitigation deferred: mirror tars to owned storage when the hosting epic lands.
- **`taste_profile` gaps:** ~37 of 47 sidecars lack profiles; the publisher backfills them. A style published without a profile would land weak (trigger-only is a sparse signal) — hence `tasteProfile` is REQUIRED in the schema and the publisher blocks emission without it.

## Out of scope

Server-side registry / community submissions; use-case-aware auto-suggestion (generators/agent surfacing styles by detected intent); style search-by-image; per-style pricing. All are natural follow-ons over this schema.
