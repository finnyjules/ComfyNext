# PRD — Variables, Collections & Batch Generation

**Date:** 2026-07-03
**Status:** Design approved, pending spec review
**Supersedes:** `2026-06-26-variables-and-data-merge-design.md` (core variable model retained; canvas representation, editing surfaces, and lifecycle redesigned)

---

## 1. Summary

Add **first-class variables** to ComfyNext: named, typed values that live in **collection nodes**
on the canvas, bind to controls across studios and Smart Layout via **chips**, and take multiple
values to power **modes, sweeps, and data-merge batch generation** — all through one primitive.

The unifying model: *a collection is a table; the row count is the only difference between its
faces.*

- **1 row** → plain variables (single source of truth: one `accent` drives many controls)
- **2–3 named rows** → modes (light/dark, Brand A/B)
- **many rows** → data-merge batch (32 team posters from a 32-row table)
- **generated rows** → sweeps ("try this in 5 palettes")

Variables are also the **agent's control surface**: the canvas agent and Vibe control patch named,
typed knobs whose changes propagate everywhere they're bound, visibly and undoably.

## 2. The core model: named variables as the single currency

Retained from the June PRD. A **target exposes named, typed bindable controls**; a **collection
supplies values keyed by column**; **binding is name-alignment**, not column→slot mapping.

```ts
type VariableType = 'text' | 'color' | 'number' | 'select' | 'image' | 'font'

interface CollectionColumn {
  key: string              // stable key, e.g. "team_name", "accent"
  label: string
  type: VariableType
  options?: string[]       // for 'select'
}

interface CollectionRow {
  id: string
  sweep?: boolean          // marked row created by a sweep
  values: Record<string /* columnKey */, string | number>
}

interface Collection {
  id: string
  name: string
  columns: CollectionColumn[]
  rows: CollectionRow[]
  previewRow: number       // index of the row bound targets resolve against
}
```

Validated against current code (2026-07-03): Smart Layout v3 kept the named-socket surface
(`{{ props.text_layer_N }}`, `{{ props.image_layer_N }}`, `{{ brand.* }}`); sections/Stacks changed
layout, not binding. Multi-output (`OutputSpec[]`) is first-class. Rendering is fully headless via
`POST /api/render-template` (satori → resvg → PNG) — the batch runner is a client loop over it.

## 3. Canvas representation (model A′: collection node + chips)

Decision after gaming node-only / panel-only / hybrid models:

- **The collection node is the single source of truth.** It stores its table in
  `node.data.properties.comfynext_collection` — inheriting serialization, persistence, copy/paste,
  and graph undo from existing node machinery (the `comfynext_localGroups` pattern). No parallel
  panel store, no second undo stack, no "two homes" ambiguity.
- **One wire per target.** The collection node has one output; a target node gets one `VARS` input.
  The wire grants scope ("this target can see these variables") and, for batch, *is* the target
  selection — rewire the collection and the batch retargets. No dropdown, no stale hidden link.
- **Chips carry per-control binding.** Bound controls show their resolved value plus a small chip
  with the variable name. No per-control sockets (avoids ComfyUI's convert-widget-to-input sprawl),
  no per-variable pill nodes.
- **Visibility on demand:** node headers show an `N vars` badge; hovering a chip highlights the
  collection node. (Later: ghost wires — hover a variable, dashed edges draw to every bound node
  and fade.)
- **Panel-as-lens (later slice):** a slim panel indexing collection nodes on the canvas — a *view*
  like the layers panel, never a second store.
- **Naming clash rule:** two collections wired into one target with a clashing column key →
  warning chip, binding disallowed until renamed. No silent precedence.

## 4. Editing surfaces: inspector + bottom drawer, no modal

The editor must never hide the canvas — live preview while editing is the feature's soul.

- **Inspector (right panel, node-inspector pattern):** select the collection node → variables as a
  form (name, type, value). Covers quick tweaks and the 1-row variables face completely.
- **Bottom drawer (kinetic-timeline shell pattern):** the full table with the horizontal width
  spreadsheets need, canvas visible above. Opened from the node ("Open table") or double-click.
  Holds: spreadsheet grid, per-column type dropdowns, CSV import + paste with type inference
  (hex → color, numeric → number), AI fill, add/remove rows/columns.
  **Clicking a row sets the preview row** — the table is the scrubber.
- **No modal.** A modal covers the canvas and can't honestly preview multi-target bindings.
- If v1 needs trimming, the drawer alone carries both faces; the inspector form is a fast-follow.

## 5. Lifecycle

### 5.1 Promote

Right-click any bindable control → **"Turn into variable"**:

1. If no collection is wired to that node, one is auto-created beside it and auto-wired.
2. A column is added: key auto-derived from the control label (`Fill color` → `fill_color`), type
   mapped from the control's `ControlSpec` type, seed value = current control value.
3. A small popover shows the pre-filled name — Enter accepts, typing renames.
4. The control is now bound (chip appears).

Binding to an existing variable: same menu → **"Bind to → <name>"**, listing type-compatible
columns from wired collections.

### 5.2 Bound state

- **Write-through:** bound controls stay editable; editing one writes the value into the
  collection cell (at the preview row) and ripples to every other binding. Unbind is explicit.
- **Literal fallback:** every binding stores `lastLiteral`. Unbind, deleted column, or a pasted
  node missing its collection → control degrades to the literal with a warning-state chip. Never a
  broken render, never a recovery flow.
- Chip menu: `Rename · Go to collection · Sweep… · Unbind`.

Binding storage, on the **target** node:

```ts
// node.data.properties.comfynext_varBindings
Record<string /* controlPath, e.g. "props.text_layer_1" or "brand.primary" or a studio param path */,
  { collectionId: string; columnKey: string; lastLiteral: string | number }>
```

### 5.3 Scrub

The collection node carries a preview-row widget (`‹ 7/32 · France ›`, seed-widget style). All
bound targets resolve against that row live. Drawer row click sets the same state. 1-row
collections have nothing to scrub.

### 5.4 Sweep

Chip menu → "Sweep…" → color: N AI-suggested values or manual list; number: min/max/steps; text:
AI suggestions. Mechanically: **appends N rows marked `sweep: true`**, each a copy of the preview
row varying only that column, then runs the batch path on those rows. From results, "keep this
one" promotes the row's values to row 1 and sweep rows clean up. One machine — a sweep is just
rows you didn't type.

### 5.5 Generate

- CTA on the drawer footer and collection node footer ("Generate 32"). Target picker only when the
  collection drives >1 renderable target (default: all).
- **Confirm modal:** `rows × outputs → total renders · cost · est. time` + pre-run validation
  warnings (bad hex, unresolvable image) with run-with-defaults or cancel. Cost line uses the
  `lib/costEstimate.ts` seam so paid targets later surface credits without re-architecting.
- **Runner (v1):** client-side loop (motion-bake pattern) over `POST /api/render-template` per
  row × output. Row isolation: a failed render is marked and skipped, never aborts the batch.
  Cancel stops queuing, keeps finished renders. The durable server-queue pattern (training queue)
  is the reserved upgrade path for paid/long Phase-3 jobs.
- **The drawer is the progress UI:** a status column appears per row (queued / rendering / done /
  failed) with retry-failed. No separate progress surface.
- Each success → `save_generation_output` tagged with batch id + row key (Assets survive
  independently of any grid).

### 5.6 Results

- **Drawer Results view:** thumbnail grid labeled by row key; click to enlarge; per-row
  regenerate; export-all zip; clicking a thumbnail scrubs the canvas preview row to match.
- **Pin to canvas:** a "Pin to canvas" action creates a **Batch results artifact node** holding
  the grid (ArtifactFrame-family) — persistent and spatial. Pinning is a button, not automatic.

## 6. AI-fill

- Drawer "AI fill" action: describe the table ("32 World Cup teams: name, primary color, crest,
  group") → LLM populates columns + rows (Haiku route, `/api/vibe`-style endpoint).
- **Image columns auto-fill with review-in-table:** the agent searches per row (existing Brave
  image-search path) and auto-picks; thumbnails land in the cells; user scans the column and
  clicks any wrong cell to swap via the existing picker. One review pass, not 32 pick steps.
- Manual CSV/paste/typing always available; AI-fill is additive.
- New `/api/*` routes must be allow-listed in `comfyui-proxy.ts` `NITRO_API_PATHS`.

## 7. Architecture

```
┌────────────────────┐   VARS    ┌──────────────────────┐  generate   ┌──────────────────┐
│ Collection node     │──────────▶│ Target node           │────────────▶│ per row×output:   │
│ comfynext_collection│  (1 wire) │ comfynext_varBindings │             │ resolve bindings  │
│ table + previewRow  │           │ chips on controls     │             │ → render → Assets │
│ drawer + inspector  │           │ "N vars" badge        │             │ → results grid    │
└────────────────────┘           └──────────────────────┘             └──────────────────┘
```

The batch spine stays behind the June PRD's target seam:

```ts
interface BatchTarget {
  listBindables(node): BindableControl[]     // named, typed controls this target exposes
  applyRow(node, values): RenderConfig       // resolved values → one render config
  render(config): Promise<Blob>              // v1: POST /api/render-template
  estimateCost(count): CostEstimate
}
```

v1 registers only `SmartLayoutBatchTarget` (props sockets + brand keys). Phase 2 adds a
studio-controls producer over `ControlSpec`; Phase 3 adds generative/workflow inputs. The
collection node, chips, drawer, runner, and results never know what a Smart Layout is.

**Resolution order:** binding values (preview row or batch row) override the control's stored
value, then flow through the existing paths — for Smart Layout, into `props` / `brand` on
`/api/render-template` (wired-socket brand already merges last via `effectiveBrand`).

## 8. Error handling

- Row isolation (per 5.5); failed rows flagged in the drawer, retryable.
- Pre-run validation in the confirm modal; run-with-defaults or cancel.
- Dangling bindings (deleted column/collection, cross-canvas paste) → literal fallback + warning
  chip (per 5.2). Deleting a collection node is an ordinary undoable graph act.
- Column key rename rewrites bindings on wired targets (rename is a first-class op, not
  delete+add).

## 9. Testing

- **Pure units:** CSV parse + type inference; promote naming (label → key, dedupe); binding
  resolution incl. literal fallback; write-through cell targeting; sweep row generation; clash
  detection; cost/count math.
- **Runner orchestration:** fake `render` covering success / failure / cancel / retry, row
  isolation.
- **Visual sign-off (required):** drawer + chips + scrub + a real batch verified in-app via
  screenshots before ship — visual output is never shipped on unit tests alone.

## 10. Phasing

- **Slice 1 — the spine:** collection node + drawer (manual/CSV/paste) + chips on Smart Layout
  sockets and brand keys + preview-row scrub + generate (confirm, runner, drawer progress) +
  drawer results + Assets.
- **Slice 2 — first-class feel:** promote/bind from studio controls (`ControlSpec` producer) +
  inspector form + sweep + AI-fill (incl. image auto-fill) + Batch results artifact node.
- **Slice 3 — reach:** panel-as-lens + ghost wires; agent ops (create/edit collections, patch
  variables, trigger sweeps); modes UX (named rows).
- **Phase 3 (unchanged from June):** generative/paid targets (prompt/seed/LoRA) on the durable
  queue; connected sources (Sheets/Airtable/Notion); collection library (cross-canvas reuse).

## 11. Scope cuts (deliberately NOT in v1)

- ❌ Per-variable pill nodes and per-control sockets (gamed and rejected — socket sprawl).
- ❌ Project-wide variable store (graph-scoped collections; brand kit covers the common
  cross-canvas case; library-save is Phase 3).
- ❌ One canvas node per batch row.
- ❌ Cross-row aggregation; computed/expression variables.
- ❌ Editor modal of any kind.

## 12. Open questions / risks

- **Studio param paths (Slice 2):** `controlPath` for modal-internal studio controls needs a
  stable addressing scheme per studio; `ControlSpec` keys look sufficient — confirm during
  planning.
- **Write-through row semantics:** write-through edits the *preview row's* cell; verify this
  feels right when scrubbed to row 20 of a dataset (editing France's color while previewing it is
  intuitive; guard against accidental dataset edits meant as "design tweaks").
- **Drawer vs. small screens:** table + canvas vertically on a 13" laptop — drawer heights and
  collapse behavior need tuning during build.
- **Image cell values:** asset refs or URLs (as June PRD); local file paths out of scope.
- **Results grid scale:** hundreds of thumbnails → virtualize later; not a v1 blocker.
