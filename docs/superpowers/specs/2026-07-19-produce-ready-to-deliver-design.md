# Produce — "Ready to deliver" — Design

**Date:** 2026-07-19
**Status:** design agreed in brainstorm; spec for review before planning.
**Premise clause:** *Produce* — the lowest-scoring clause in the 2026-07-08 wargame (6.5/10). This is the deliberate move to raise it.

---

## 1. What this is

A per-project **delivery surface**: a distinct full page where the user collects the
artifacts they consider finished, names and arranges them however they like, and
gets them off the machine (download / zip; sharing later).

It is a **curation surface, not a production surface**. It renders nothing and
generates nothing. Everything on it is an artifact that already exists on the
canvas as an output file on disk. The user's judgment — *this one is ready* — is
the only thing that puts an item here.

### One-sentence test (how we know it worked)
> "I marked six things ready, named and grouped them, and handed a client a clean
> zip — without leaving Sailor."

---

## 2. Model (the spine)

Two decisions from the brainstorm shape everything below, and both **narrow** scope:

1. **You only mark artifacts that already exist.** A Gradient Studio node or a
   Timeline is a *recipe*; the thing you mark ready is the image/video artifact it
   already produced. So there is **no bake step, no "preparing" state, no
   render-on-demand.** Marking ready is instant — it records that an existing file
   is a deliverable. *(This supersedes the earlier "bake file + provenance"
   direction, which assumed finishing a recipe; the user corrected it — you never
   mark a recipe, only its output.)*

2. **The system never classifies.** No provenance inference, no auto-versioning, no
   auto-collection. The user names items and groups them by hand. "Versions of the
   hero" and "the four formats of the launch post" are not two features — they are
   both **one primitive: a named set the user made.** What a set *means* is the
   user's semantics, never the system's.

The system's only jobs: **hold the file, remember the user's name / grouping /
order.**

### Data shape

Add one field to `ProjectDoc` (`frontend/app/lib/projectDoc.ts:16`):

```ts
interface ProjectDoc {
  // ...existing
  /** Ordered delivery shelf. Array order == display order (user-arrangeable). */
  deliverables?: DeliverableItem[]
}

/** A reference to one existing on-disk output artifact. */
interface ArtifactRef {
  filename: string          // as recorded on the canvas output (type: 'output')
  subfolder: string
  media: 'image' | 'video' | 'audio'
  sourceNodeId?: string | null   // for "Open in canvas"; null once the node is gone
  // display metadata captured at mark-ready time (never re-derived):
  meta?: { w?: number; h?: number; durationMs?: number; ext?: string }
}

type DeliverableItem =
  | { id: string; kind: 'single'; name: string; ref: ArtifactRef }
  | { id: string; kind: 'set';    name: string; items: ArtifactRef[]; coverIndex?: number }
```

- `name` defaults from the source node label or filename at mark time; freely
  editable thereafter.
- A **set** always holds ≥2 refs. Removing items until one remains **dissolves** it
  back to a single. `coverIndex` (default 0) picks the tile thumbnail.
- Records reference the **existing immutable output** (`type: 'output'`, already
  promoted via `promoteTempImages`). No copy is made at mark time.

### Why this field, not a separate store
It travels with the project, survives restarts, and — the load-bearing reason —
a future hosted **Share** page becomes a *reader* of `deliverables[]` rather than a
rewrite. Deferring sharing stays genuinely deferred, not a rebuild.

---

## 3. Gestures

| Gesture | Where | Effect |
|---|---|---|
| **Mark ready** | On the canvas artifact node (`ArtifactImageNode`, `…Video`, `…Audio`, `…Frame`, `…3D`, `…Timeline`) — a small action, not on this page | Appends a `single` referencing that output file. Marking an already-present artifact is a no-op (toast: "Already in deliverables"). |
| **Rename** | Inline on the caption (pencil on hover) | Sets `name`. |
| **Group into set** | Select ≥2 tiles → "Group into set" in the selection bar | Wraps the picks in a new `set`, removes them as top-level items, default-names it. |
| **Ungroup** | Set detail view | Restores members as top-level singles. |
| **Reorder** | Drag tiles in the grid | Persists `deliverables[]` order. |
| **Reorder within a set** | Drag in set detail | Persists `items[]` order; drives cover + zip order. |
| **Remove from shelf** | Hover menu / set detail | Removes the item. **Does not delete the underlying output file** — that is a canvas/asset concern. |
| **Download** (single) | Hover | Fetches the one file. |
| **Download** (set) | Hover | **Zip of all files in the set**, member order = set order. |
| **Download all** | Top bar | One zip of the whole shelf; each set becomes a subfolder. |
| **Open in canvas** (single) | Hover | Navigate to canvas, focus `sourceNodeId`. Disabled (file still downloadable) if the node is gone. |
| **Open set** | Hover | Set detail overlay (members, reorder, ungroup, per-member download/remove). |
| **Share** | Top bar | **Deferred.** Rendered as a quiet ghost button with a `soon` tag, to mark the seam. No behavior. |

---

## 4. Surfaces / components

- **The view** — a project-scoped full-page view that is a **peer of the canvases**,
  not a route. It is reached the same way you switch canvases: from the top-left
  **`ProjectMenu`** chip (`frontend/app/components/vue-canvas/ProjectMenu.vue`), which
  already lists the project's canvases with "+ New canvas". Deliverables becomes a
  pinned entry in that dropdown (with a count), above or below the Canvases section.
  Selecting it swaps the main area from the node canvas to the deliverables grid;
  the chip label reflects it ("Aurora Spring / Deliverables").
  - It is **one per project, pinned** — unlike a canvas it is never renamed or
    deleted from the menu. Exactly one exists; the menu entry toggles into it.
  - This needs a project-level view mode. `default.vue` (which owns the doc and
    `activeCanvasId`) gains a `view: 'canvas' | 'deliverables'` state; `ProjectMenu`
    emits a `showDeliverables` event alongside its existing `switchCanvas` /
    `addCanvas`. Switching to a canvas sets `view = 'canvas'`. No router, consistent
    with existing project navigation.
  - Top bar (within the view): project name · Download all · Share (ghost). Return
    is via the same `ProjectMenu` chip (pick a canvas).
  - Header: title + one line of guidance.
  - Selection bar: appears when ≥1 tile is picked → "N selected · Group into set · Clear".
  - Grid: arrangeable tiles. Singles show artwork + editable name. Sets show a
    layered/stacked frame + a count badge. Video tiles show a play glyph.
  - Set detail overlay: members with reorder / ungroup / per-member actions.

  *(The future Share page is this same view with a read-only reader over the same
  `deliverables[]` record — a hosted route added later, not a change to how the
  in-app view is reached.)*

- **Mark-ready affordance** — a small control on each artifact node component. One
  shared composable (`useDeliverables`) exposes `markReady(nodeId) / isReady(nodeId)`
  so every artifact node wires the same toggle. Visual: reuse the emerald
  commit-color language (emerald = "committed / ready") consistent with the north
  star's reserved-emerald rule.

- **Zip builder** — reuse the existing `frontend/app/lib/collection/batchZip.ts`
  pattern (JSZip, fetch-blob-per-file, object-URL download). Generalize it to a
  small `deliverablesZip.ts` that takes `ArtifactRef[]` (+ optional subfolder-per-set
  for Download all).

### Module boundaries
- `lib/deliverables/model.ts` — pure state ops: `addSingle`, `group`, `ungroup`,
  `rename`, `reorder`, `reorderWithinSet`, `remove`, `dissolveIfUnderTwo`,
  `isPresent`. No I/O. Fully unit-testable.
- `lib/deliverables/zip.ts` — ref[] → zip download (thin, over JSZip).
- `composables/useDeliverables.ts` — binds the model to the ProjectDoc ref +
  persistence; exposes the gestures to both the page and the artifact nodes.
- `components/vue-canvas/DeliverablesPage.vue` (+ `DeliverableTile.vue`,
  `DeliverableSetOverlay.vue`) — the view.
- `ProjectMenu.vue` — add the pinned "Deliverables" entry + `showDeliverables` emit.
- `default.vue` — add `view: 'canvas' | 'deliverables'` state; render the page in
  place of the canvas when active; wire the new emit.

---

## 5. Format machinery stays upstream

Multi-format output (Smart Layout, batch export) is **not** re-implemented here.
Smart Layout / `runBatch` already produce N image artifacts. The user marks those
ready and groups them — the "Launch Post = 4 formats" set is just the general set
primitive applied to batch outputs. Produce treats every input as an ordinary
artifact; `shared/template-grid/` keeps sole ownership of formats.

---

## 6. Persistence & edge cases

- **Migration:** `deliverables` absent ⇒ treat as `[]`. No migration write needed;
  `toProjectDoc` leaves it undefined and readers default it.
- **Source node deleted:** `sourceNodeId` goes stale → "Open in canvas" disabled;
  download still works (the file is independent of the node).
- **Underlying output file missing** (pruned/deleted on disk): tile shows an
  "unavailable" placeholder; download/zip skips it and reports what was skipped
  (no silent drop). Detection is best-effort (fetch 404) — full lifecycle GC of
  orphaned refs is out of scope.
- **Mark same artifact twice:** no-op.
- **Set drops below 2 members:** auto-dissolve to a single.
- **Download-all with a missing file:** zip the rest; surface a count of skipped.

---

## 7. Testing

- **Unit (`lib/deliverables/model.ts`):** add/group/ungroup/rename/reorder/remove,
  dissolve-under-two, present-detection, order preservation. Pure, exhaustive.
- **Unit (zip):** manifest shape — set → flat file list in order; download-all →
  set-as-subfolder layout; skipped-missing accounting.
- **Integration/e2e:** mark ready from an artifact node → tile appears on the page;
  select two → group → set with count 2; reorder → order persists across reload;
  Download all → zip contains the expected entries; delete source node → Open in
  canvas disabled but download intact.

---

## 8. Scope boundaries (YAGNI)

**In:** the page; mark-ready on artifact nodes; single/set model; rename; group /
ungroup; drag-arrange; download (file / set-zip / all-zip); open-in-canvas;
persistence in ProjectDoc.

**Explicitly out (this pass):**
- Sharing / hosting / any network delivery (the ghost button only).
- Comments / review / approval loop.
- Any bake / render / on-demand generation.
- Auto-versioning, auto-collection, provenance inference.
- Format *generation* (owned by Smart Layout upstream).
- Orphaned-ref garbage collection beyond best-effort "unavailable" display.

---

## 9. How this raises the clause

- Gives Produce a **destination** — the app had batch export and timeline render but
  no place where "finished" is a state and deliverables live together.
- Extends the existing **promote/ready ladder** (sketch → take → promote → ready) with
  one more honest rung, in the same vocabulary — not a bolted-on Export menu.
- Lands the **async-review seam** (Share-later) as a first-class deferred, on a record
  a hosted page can read unchanged — the field's open white space (Firefly/Flora hand
  off; nobody finishes on-canvas) without taking on multiplayer.
