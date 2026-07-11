# PRD — Variables & Data Merge (Batch Generation)

**Date:** 2026-06-26
**Status:** Superseded by `2026-07-03-variables-collections-design.md` (core variable model retained; canvas representation, editing surfaces, and lifecycle redesigned)
**Author:** brainstormed with Claude

---

## 1. Summary

Add a **variables + data-merge** system to Sailor so a user can drive a studio (and later
any workflow node) from a **table of data** and **generate in batch**.

North-star scenario: for the World Cup, build a Smart Layout poster template, connect a table of
32 teams (name, primary color, secondary color, crest image, group), and generate 32 on-brand
posters in one run — saved to Assets and reviewable in a results grid.

The system is built as a **studio-agnostic spine** (dataset → variables → batch runner → results)
with a **narrow first target** (Smart Layout). The hard, heterogeneous work — promoting arbitrary
studio controls to variables, and binding to generative workflow nodes — is phased in later on the
**same spine**, not as new systems.

## 2. The core model: named variables as the single currency

The central design decision. We do **not** model this as "map dataset columns → template slots."
We model it as:

> A **target exposes named, typed variables**. A **dataset supplies values keyed by variable
> name**. **Binding is name-alignment**, not column-to-slot mapping.

This is closer to Figma variables than to InDesign Data Merge, and it pays off across all three
phases:

- **Phase 1 (Smart Layout):** template slots already have names (`text_layer_1`, brand `primary`),
  so they are *already* named variables. We ship the real model on day one, not a stand-in.
- **Phase 2 (promote controls):** "promote a control to a variable" just means *giving a control a
  variable name*. It produces the same `Variable[]` the Smart Layout adapter produces — same
  dataset, same runner, same grid. No rework.
- **Phase 3 (workflow nodes):** binding a prompt/seed/LoRA on a generative node is again just "this
  input has a variable name." One model, three producers.

### Types

```ts
type VariableType = 'text' | 'color' | 'number' | 'select' | 'image' | 'font'

interface Variable {
  name: string            // stable key, e.g. "team_name", "primary"
  label: string           // human label for UI
  type: VariableType
  default?: ValueForType  // fallback when a row omits it / no binding
  options?: string[]      // for 'select'
}

// A dataset row is values keyed by *column key*; binding aligns column key → variable name.
interface Dataset {
  columns: { key: string; label: string; type: VariableType; options?: string[] }[]
  rows: Record<string /* columnKey */, string | number>[]
  source: 'manual' | 'csv'
}

interface Binding {
  datasetNodeId: string
  map: Record<string /* variableName */, string /* columnKey */>  // unmapped → variable.default
}
```

## 3. Architecture

```
┌──────────────┐  DATASET   ┌────────────────────┐  batch run   ┌──────────────────┐
│ Dataset node  │──────────▶│ Target node         │─────────────▶│ per row:          │
│ (table / CSV) │           │ (Smart Layout v1)   │              │  applyRow → render│
│ columns+rows  │           │  exposes Variable[] │              │  → Assets         │
└──────────────┘           │  + Binding map      │              │  → results grid   │
                            └────────────────────┘              └──────────────────┘
```

### The spine is studio-agnostic, behind one interface

```ts
interface BatchTarget {
  listVariables(node): Variable[]          // what this target exposes
  applyRow(node, values): RenderConfig     // resolved variable values → a render config
  render(config): Promise<Blob>            // produce one output
  estimateCost(rowCount): CostEstimate     // { credits, seconds, free }
}
```

The Dataset node, binding layer, batch runner, and results grid **never know what a Smart Layout
is**. v1 registers exactly one implementation, `SmartLayoutBatchTarget`. Phases 2/3 register more.

### Components

1. **Dataset node** (new) — vue-flow type `dataset`, frontend-only artifact (no ComfyUI backend
   class). Persisted at `node.data.properties.sailor_dataset`. One `DATASET` output handle.
   - Editor modal: a spreadsheet-style grid — add/remove rows & columns, set per-column type,
     **paste tabular data** or **import .csv** with type inference (hex → color, numeric → number).
   - Inline shortcut: a target node can **spin up an attached dataset** (node created + auto-wired
     behind the scenes) so simple single-target cases feel like a "Batch" panel rather than manual
     wiring. The standalone node remains the real primitive and stays reusable across targets.

2. **Binding** — the target node gains a `DATASET` input slot. On connect we call
   `target.listVariables(node)`, then **auto-align** by name (exact → alias → fuzzy). A **Mapping
   panel** shows each variable with a column dropdown (pre-filled, correctable). **Type-compatible
   alignments only** (color column → color variable, image → image, etc.). Stored at
   `node.data.properties.sailor_dataBinding`. Unmapped variables fall back to `variable.default`.

3. **Batch runner** — a "Generate batch" action.
   - **Confirm modal first:** "N rows × M template outputs → K renders · est. *free* (template
     render) / ~X credits · ~Y sec" → confirm. The cost line is wired now so Phase-3 paid targets
     surface credits without re-architecting.
   - Per-row loop with **row isolation**: a failed render is marked and skipped, never aborts the
     batch (same pattern as the kinetic frame bake). Progress UI: queued / rendering / done /
     failed, with cancel and retry-failed.
   - Each success → `save_generation_output` (tagged with the row's key) **and** a thumbnail into
     the results grid.

4. **Results grid / contact sheet** — modal: one thumbnail per variant, labeled by row key; click
   to enlarge; **regenerate a single row**; **bulk export as zip**; failed rows flagged with retry.
   Files also live in Assets independently, so "just grab the campaign" works without the grid.

### Batch count

Batch count = **rows × the target's existing `outputs[]`**. Smart Layout already supports multiple
named outputs (1:1, 9:16, 16:9), so one row can yield the whole set in a single run. The guardrail
shows the multiplied total.

## 4. Data flow (World Cup walkthrough)

1. User builds a Smart Layout poster with slots `text_layer_1` (team), brand `primary`/`secondary`,
   `image_layer_1` (crest).
2. User adds a Dataset node, pastes/imports a 32-row CSV (`team_name, primary, secondary, crest`).
3. Wires Dataset → Smart Layout. Auto-align maps `team_name→text_layer_1`, `primary→primary`,
   `secondary→secondary`, `crest→image_layer_1`; user confirms in the Mapping panel.
4. Clicks "Generate batch" → confirm modal shows "32 rows × 1 output → 32 renders · free · ~Ns".
5. Runner loops rows, rendering each via the existing template render path, saving to Assets, and
   filling the results grid. Failed rows (e.g. a bad crest URL) are flagged and retryable.

## 5. Persistence

- Dataset → `node.data.properties.sailor_dataset`.
- Binding → `node.data.properties.sailor_dataBinding`.
- Both serialize with the graph and survive reload. Edits to dataset columns after binding are
  reconciled in the Mapping panel: now-missing columns show as unmapped (fall back to default).

## 6. Error handling

- **Row isolation:** one failed render never aborts the batch.
- **Pre-run validation:** invalid cells (bad hex, unresolvable image ref) surface as warnings in the
  confirm modal; user can run-with-defaults or cancel.
- **Stale binding:** dataset edited after binding → Mapping panel flags unmapped variables; missing
  values fall back to `variable.default`.
- **Cancel:** stops queuing further rows; already-rendered outputs are kept.

## 7. Testing

- **Pure functions (unit):** CSV parse + type inference; column→variable auto-align; row→values
  resolution; type coercion/validation; cost/count math.
- **Runner orchestration:** tested with a fake `render` covering success / failure / cancel paths
  and row isolation.
- **Results aggregation:** grid state, retry, zip manifest.
- **Visual sign-off (required):** the World Cup demo verified in-app via screenshots before ship —
  per the project rule that visual output is never shipped on unit tests alone.

## 8. Phasing

- **Phase 1 (this spec):** Dataset node (+ inline shortcut) · CSV/paste/manual · name-aligned
  binding with auto-match + override · cost-preview guardrail · batch runner with row isolation ·
  Assets + results grid. **Target: Smart Layout only.** Delivers the World Cup demo.
- **Phase 2:** "Promote any control to a variable" across Type / Gradient / Shader / Texture
  studios — a new `BatchTarget` producer over the existing `ControlSpec` schema. Reuses the entire
  Phase-1 spine.
- **Phase 3:** Bind variables to generative / workflow nodes (prompt / seed / LoRA), mapping rows
  to backend `batch_size` where cheaper; connected live data sources (Airtable / Google Sheets /
  Notion). Guardrail already accounts for paid targets.

## 9. Scope cuts (deliberately NOT in v1)

- ❌ Promote-any-studio-control-to-variable → Phase 2.
- ❌ Generative / paid binding targets (prompt / seed / LoRA) → Phase 3.
- ❌ Connected live databases (Airtable / Sheets / Notion) → Phase 3.
- ❌ Spawning one canvas node per row (clutters the graph at 32+ items).
- ❌ Cross-row aggregation (totals, dedupe) — the dataset is treated as independent rows.

## 10. Open questions / risks

- **Image variables:** a `crest` column needs to resolve to something the renderer can draw. v1
  accepts an uploaded-asset reference or a URL; arbitrary local file paths are out of scope.
- **Type inference ambiguity:** a column of hex-looking strings vs. plain text — inference picks a
  default, but the column-type dropdown is the authoritative override.
- **Results grid scale:** 32 is comfortable; hundreds of thumbnails need virtualized rendering —
  note for the implementation plan, not a v1 blocker at expected sizes.
- **Inline-shortcut lifecycle:** when a target spins up an attached dataset, deleting the target
  should offer to delete the orphaned dataset (or leave it as a reusable standalone) — decide in
  the plan.
