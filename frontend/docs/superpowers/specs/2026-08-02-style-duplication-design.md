# Style duplication — one training run, several taste profiles

**Date:** 2026-08-02
**Status:** approved, ready to implement

## Problem

A trained style LoRA carries exactly one taste profile. The profile is not baked
into the weights — it is plain text in the `.json` sidecar, prepended to the
prompt as the node's `aesthetic` property at run time. So wanting a second
aesthetic over the same training set costs nothing in principle, but there is no
way to express it:

- **Local LoRAs** — the sidecar is 1:1 with a weights filename, one aesthetic each.
- **House styles** — `upsertHouseStyle` dedupes on `replicateModel`, so publishing
  a second entry against the same trained model silently *replaces* the first.

## Approach

Duplicate the **sidecar**, not the weights. `GET /api/loras-local` already builds
one gallery entry per base name from either the `.safetensors` **or** the `.json`
— sidecar-only entries are an existing supported shape (that is how the deployed
server lists LoRAs whose weights live only on Replicate). So a copied sidecar
appears in both the LoRA gallery and the Style Publisher for free, at a cost of
~3 KB instead of ~344 MB.

Rejected: copying the weights too (wasteful, byte-identical file); a
`profiles: []` array inside one sidecar (truest model, but changes the shape read
by the GET loop, the publisher's per-filename draft map, and the `lora` filename
stored on canvas nodes).

## 1. What a duplicate is

A new `models/loras/<NewName>.json` with no weights file:

```json
{ "name": "Azure Bloom Noir", "base_model": "flux-dev", "provider": "replicate",
  "trigger": "azure_bloom",
  "replicate_model": "finnyjules/jules-azure_bloom:161403ca…",
  "replicate_url": "https://replicate.delivery/…/trained_model.tar",
  "aesthetic": "<copied from the original, to be rewritten>",
  "trained_on": "2026-06-04T05:42:25.677Z",
  "kind": "style", "duplicate_of": "Azure_Bloom" }
```

Carried over, each for a reason:

- `replicate_model` / `replicate_url` — what actually runs. Both cards drive the
  same hosted weights.
- `trigger` — baked into the weights at training time; a different trigger would
  not activate the LoRA.
- `trained_on` — `GET /api/dataset-match` resolves a LoRA's training folder purely
  from this field, so the copy auto-matches the *same* `input/lora_dataset_*`
  folder. This is what makes the Style Publisher's "rewrite the profile from the
  training images via Fable" button work on the duplicate.
- `base_model`, `provider`, `kind` — plain metadata.

Dropped: `replicate_prediction_id` (belongs to the original training run) and the
cover image (a duplicate starts with a blank card and the existing Generate
button, so the card never shows an image the new profile did not produce).

`duplicate_of` is provenance only; nothing reads it.

## 2. API surface

All three verbs stay on the exact path `/api/loras-local`. That path is an
**exact**-match entry in `comfyui-proxy.ts`'s `NITRO_API_PATHS` (`path === p ||
path.startsWith(p + '?')`), so a nested `/api/loras-local/duplicate` would fall
through to ComfyUI and 404. Path matching there is method-agnostic, so new verbs
on the same path need no allowlist change.

- **`POST /api/loras-local`** — body `{ filename, name }`. Reads the source
  sidecar, applies the carry/drop rules above, writes `<kebab_name>.json`.
  - 409 if the target base already exists (sidecar or weights).
  - 422 if the source has no `replicate_model` — a purely local LoRA has no
    hosted ref, so a weightless copy would be dead on arrival.
- **`DELETE /api/loras-local`** — body `{ filename }`. Removes the `.json` and any
  `.cover.*`.
  - 409 if a matching `.safetensors` exists. Only sidecar-only copies are
    removable; trained weights are structurally safe from this route.
- **`PATCH /api/loras-local`** — relax the existence gate from "weights must
  exist" to "weights **or** sidecar must exist". Required for a copy to be
  editable; also fixes the deployed-server case where sidecar-only LoRAs are
  listed but cannot be edited today.

Every route keeps the existing bare-filename guard (rejects `/`, `\`, `..`) —
that guard is the only thing between these handlers and path traversal, so the
new routes reuse it rather than rolling their own.

## 3. UI — LoRA gallery

A **Duplicate** button next to the existing Edit (pencil) in the card header,
under the same `!houseStyle` condition (house items have no sidecar to write).

Flow: click → POST → re-fetch the list → focus the new card and open the existing
edit panel with `editName` pre-filled `"<Name> copy"`, `editTrigger` and
`editAesthetic` carried over, focus in the Aesthetic textarea. Save goes through
the same PATCH the pencil already uses — no second save path.

**Delete** lives inside the edit panel next to Cancel, rendered only when
`sizeBytes === null` (the list reports null exactly when weights are absent,
which is the same condition the server enforces). One confirm dialog.

A copy reads "Trained · Replicate" with no size, same as its original — honest,
since it is the same trained model. The pre-filled `"… copy"` name is the only
visual distinction, which is why the editor opens immediately.

## 4. House styles — two entries, one model

`id` becomes the uniqueness key. It already is one in practice: the publisher
derives it as `kebab(l.name)` and thumbnails are written to
`public/house-styles/<id>/`.

- **`upsertHouseStyle`** — dedupe on `id` instead of `replicateModel`. Existing
  ids are unique, so this is a no-op for every published style; no migration.
- **`findIdCollision`** — unchanged. It guards same-id-different-model (two
  unrelated styles clobbering each other's thumbnail directory) and is now the
  only uniqueness rule.
- **`update-profile`** — matches by `replicateModel` today; with two entries
  sharing a model that silently edits an arbitrary one. Match by `id`.
- **`style-publisher.vue`** — four lookups (`isPublished`, `draftFor`,
  `thumbnailSources`, and `publish`'s `existing`) resolve a card's published entry
  by `replicateModel`; all move to `id === kebab(l.name)`, and `saveProfile` sends
  `id`. Leaving any one on the model key makes the publisher show a duplicate as
  already-published, pre-fill the original's use-case tags, and display the
  original's thumbnails.

## 5. Testing

Unit tests (`tests/unit/`, vitest, node env):

- **Store** — two entries sharing a `replicateModel` with different ids both
  survive an upsert; replace-by-id still replaces; existing `findIdCollision`
  tests stay green unchanged (the signal that the guard survived).
- **Sidecar duplication** (pure functions, no fs) — carry/drop rules; the derived
  base name is kebab-safe and collision-checkable.
- **Handlers** (temp dir) — POST writes a sidecar with the model ref and
  `trained_on` carried and the prediction id dropped; POST 409s on an existing
  name; DELETE refuses with weights present and succeeds without; PATCH succeeds
  on a sidecar-only base.

Not covered by unit tests, and owed as a live check: that a duplicate actually
renders through the same weights, and that the publisher auto-matches its dataset
folder. Green unit tests are not evidence for either.
