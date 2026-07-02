# Character Unification + Variants — design spec

**Date:** 2026-07-02
**Status:** Draft for review
**Supersedes:** the "reference-first, LoRA optional" entity model of `2026-07-01-character-cast-shot-director-design.md` (the cast *pipeline* from that spec is unchanged; only the entity model and panel evolve).

## Problem

The Characters panel exposes two systems the user should never see as separate: "Castable characters" (registry records with reference sheets, built for video casting) and "Character" LoRAs (trained identities, built for image generation), bridged by a "Make castable" button. The split is build-order history, not a concept. Additionally: a character has exactly one look — no way to define variants (haircut, wardrobe) with their own reference sheets; the panel can only dispatch image generation (not casting); and the panel's style-pairing composer duplicates what the generation nodes' own pickers already do.

## Principles (locked during brainstorm)

1. **One character system.** One list, one card per person. The LoRA/registry split dissolves.
2. **A character's canonical identity is a trained LoRA.** Reference sheets are *renders from the LoRA* — perfect consistency, ~$0.03/image. Characters without a LoRA exist only as **drafts** ("train to complete"), created by quick-capture paths; drafts can still cast (their photos work today) but training is the promoted path.
3. **Variants:** a character has looks — `Default` plus user-defined variants (label + descriptor like "short bob, yellow raincoat"), each with its own generated reference sheet.
4. **Dual dispatch from the panel:** use in an image generation AND cast into a Shot Director.
5. **Style leaves the panel.** Pick style on the generation node (its pickers already support this). The panel is a pure library.

## Data model

`models/characters/<slug>.json` evolves:

```jsonc
{
  "name": "Vera", "slug": "vera",
  "loraName": "Vera.safetensors" | null,     // null ⇒ draft
  "trigger": "VERA" | null,
  "notes": "",
  "variants": [
    { "id": "default", "label": "Default", "descriptor": "", "refImages": ["…"], "coverIndex": 0 },
    { "id": "v-…",     "label": "Raincoat", "descriptor": "short bob, yellow raincoat, wet hair", "refImages": ["…"], "coverIndex": 0 }
  ],
  "createdAt": "…", "updatedAt": "…"
}
```

- **Migration (read-time, self-healing like today):** a record with legacy top-level `refImages`/`coverIndex` hydrates them into `variants[0] = { id: 'default', label: 'Default', descriptor: '' }` and persists on next write. `parseCharacterRecord` owns this.
- **Status is derived, not stored:** `draft` = no `loraName`; `training` = a training-queue job matches this character (live from `GET /api/training-queue`); `ready` = `loraName` set.
- `CastMember` gains `variantId?: string` (absent = default). `resolveRefs(slugs)` becomes variant-aware: `resolveRefs(picks: {slug, variantId?}[])`.

## Unification & migration

- **Auto-absorb on panel load (idempotent):** every `kind:'character'` LoRA in `/api/loras-local` without a registry record gets one created (`loraName`/`trigger` linked, empty Default variant). "Make castable" is removed.
- **Merge auto-generation (explicitly accepted spend):** absorbed characters with an empty Default sheet auto-render it via their own LoRA (4 canonical prompts × ~$0.03 ≈ **$0.12/character, one-time**). Guarded idempotent: only fires when the Default variant has zero refs AND no generation for that character is already in flight; a panel banner shows progress ("Rendering reference sheets for 4 merged characters…"). Failures leave the variant empty with a per-character retry button (no loop).
- The cloud trainer's finalize path (which already tags `kind:'character'`) now also creates-or-updates the registry record: training a **draft**'s photos flips the same record to ready (match by slugified name), never duplicating the person.
- **Quick-capture paths create drafts:** "Save as character" on an image artifact and the CharacterSheet canvas node's photo mode both produce a draft (photos land in the Default variant). The CharacterSheet node's LoRA mode attaches to the existing ready character instead of creating a new record; if none exists for that LoRA, it creates the record ready-linked.

## Variant generation

- **"New variant"** on a character: label + descriptor → renders the 4-shot canonical sheet, per-tile re-roll, explicit priced button:
  - **Ready characters:** through their LoRA via the existing `loraGen` rail — prompt = `trigger + ", " + descriptor + ", " + canonicalScene.prompt` — `~$0.12`.
  - **Draft characters:** through ideogram (`character-shot.post.ts`) from the draft's anchor photo (Default variant's cover), descriptor folded into the scene prompt — `~$0.32`.
- Regenerating an existing variant's sheet = same button on the variant ("Regenerate sheet"), replaces refs.
- Reuses `CHARACTER_SHEET_CANONICAL` + the Sheet Builder's generation/tile mechanics, extracted into a shared composable `useSheetGeneration` so the panel and the CharacterSheet canvas node don't fork the logic.

## Panel redesign (pure library)

One section, one card per person:

- **Card:** cover (Default variant), name, status badge — `Draft — train to complete` (action: **Train identity** — opens the trainer in character mode pre-seeded with the draft's photos) / `Training…` (progress from the queue) / LoRA chip when ready.
- **Expanded:** variants row (chips: Default + others, each showing sheet count; select to view its sheet grid with add/remove/re-roll/cover), **New variant**, notes, delete.
- **Actions per character:** **Use in image** (ready → adds the LoRA generation node with the character slot + trigger pre-filled, style chosen ON THE NODE; draft → adds `ConsistentFaceNode` with the anchor photo pre-filled) · **Cast in shot** (spawns a Character canvas node pre-picked with character + selected variant).
- **Removed:** the "Castable characters" / "Character" split, the Style search + pairing composer, "Add to canvas" composer flow, "Make castable".

## Cast & canvas integration

- Cast picker: characters with >1 variant show a variant selector on pick; `CastMember.variantId` persists; chips render "Vera · Raincoat"; the cast-photos row (the [ImageN] strip) shows the variant's sheet.
- Character canvas node: variant dropdown when >1 (stores `comfynext_characterVariantId`); edge-sync (`wireCastFor`) carries variantId through.
- Generate-path resolution reads the variant's `refImages`. Everything downstream (materializeCast → castClause → compile → dispatch → Python) unchanged.
- Zero-refs error message becomes variant-aware ("Vera's Raincoat sheet has no photos yet").

## Error handling & costs

- All generation behind explicit `~$` buttons except the sanctioned one-time merge auto-gen (banner + per-character retry on failure, never auto-loops).
- Draft training seed: if a draft has <3 photos, Train identity warns that more photos train better (dataset builder can expand first).
- Registry API (`characters-local.patch`) extends for variants (add/rename/delete variant, per-variant refImages/coverIndex) with the same filename validation; deleting a variant that a shot casts surfaces as the existing zero-refs compile error naming the variant.

## Testing

- Pure: record hydration/migration (legacy refImages → Default variant), variant-aware `resolveRefs`, castMember variantId through hydrate/materialize/wireCastFor/syncCast, prompt goldens unchanged.
- Registry: variant CRUD validation, absorb idempotency (second load creates nothing).
- UI: harness/browser — panel card states (draft/training/ready), variant switch updates the cast strip; NO paid clicks in verification except where explicitly sanctioned (merge auto-gen may fire once against real LoRAs — acceptable per decision).

## Out of scope

Per-shot wardrobe overrides beyond descriptor-in-Subject (documented in UI); training variants into their own LoRAs; multi-LoRA characters; style anywhere in the panel; video/audio variant refs.
