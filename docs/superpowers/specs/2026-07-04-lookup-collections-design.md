# Lookup Collections — Design

**Date:** 2026-07-04
**Status:** Approved (brainstorm) — pending spec review

## Goal

Let one collection resolve values from a second collection by matching on a shared key, so a single key value drives many downstream properties. The motivating case:

- **Players** (wired to a studio): `Name = Mbappe`, `Country = France`.
- **Themes** (a reusable dictionary): `Country = France → Fill1 = blue, Text = white`.
- The studio's text binds to `Name`; its fill/text colors resolve *through* the link: Mbappe → France → blue/white.

Edit the France→colors mapping **once** in Themes and every French player picks it up, live in preview and per-row at Run time.

This is a relational **lookup / VLOOKUP** (one join, non-recursive). It extends the existing resolve step; it does **not** change how studios bind (they just gain more columns to bind to).

## Non-goals (explicit, YAGNI)

- **Chained lookups** (Name → Country → Theme, multi-hop). One join only. `resolveLinkedCell` reads a *real* foreign column, never a foreign linked column — this also guarantees no recursion/cycles.
- **Cross-project shared dictionaries.** Themes is a normal in-project collection for now.
- **Editing foreign data inline** from the driver table — read-only; you edit in the foreign collection's own drawer.
- **Many-to-many.** A local row matches at most one foreign row (first match wins; see edge cases).

## Concepts & vocabulary

- **Driver collection** (Players): wired to the studio, iterated by rows at Run.
- **Lookup collection** (Themes): a reference table keyed by a column; not iterated.
- **Lookup edge** (`LOOKUP`): canvas edge `Themes → Players`.
- **Link record**: metadata on the driver describing one lookup edge.
- **Linked column**: a *virtual*, read-only column that appears on the driver, sourced from a foreign non-key column, resolved per row by the key match.

## 1. Data model (`lib/collection/types.ts`)

```ts
export interface CollectionLink {
  collectionId: string   // foreign (lookup) collection id — e.g. Themes
  matchLocal: string     // driver column key used as the key   (Players.Country)
  matchForeign: string   // foreign key column                  (Themes.Country)
}
// CollectionData gains:
//   links?: CollectionLink[]

export const LOOKUP_TYPE = 'LOOKUP'
```

`links` is optional; absent = today's behavior byte-for-byte. Linked columns are **derived** from `links` + the foreign collection, never stored on the driver's `columns`/`rows`.

## 2. Pure lookup module (`lib/collection/lookup.ts`, new)

All pure (no Vue/canvas), unit-tested in isolation.

```ts
export type LookupResolver = (collectionId: string) => CollectionData | undefined

export interface LinkedColumn {
  key: string              // effective key on the driver (namespaced on collision)
  label: string
  type: VariableType
  sourceCollectionId: string
  sourceColumnKey: string  // foreign column pulled in
  matchLocal: string       // driver key column
  matchForeign: string     // foreign key column
}

// All linked columns contributed by the driver's links (foreign non-key columns).
// Collision with an existing driver column key → namespaced key + "<Foreign> · <label>".
export function linkedColumns(local: CollectionData, resolve: LookupResolver): LinkedColumn[]

// Real columns + linked columns, as a flat CollectionColumn[] for the bind menu.
export function effectiveColumns(local: CollectionData, resolve: LookupResolver): CollectionColumn[]

// Returns the LinkedColumn for a key, or null if it's a real/unknown column.
export function findLinkedColumn(local: CollectionData, resolve: LookupResolver, key: string): LinkedColumn | null

// Resolve one linked cell for a driver row: read row[matchLocal], find the foreign row
// where foreign[matchForeign] === that value (first match), return foreign[sourceColumnKey].
// undefined when: no key value, no foreign collection, or no matching foreign row.
export function resolveLinkedCell(
  local: CollectionData, rowIndex: number, col: LinkedColumn, resolve: LookupResolver,
): string | number | undefined
```

## 3. Resolver integration (`lib/collection/resolve.ts`)

`resolveBindings` gains an **optional** 4th arg — fully backward compatible:

```ts
export function resolveBindings(
  c: CollectionData, bindings: VarBindings, rowIndex: number,
  resolve?: LookupResolver,
): { values; missing }
```

Per binding: look up the cell in `c.columns` as today; if not found and `resolve` is provided, try `findLinkedColumn` → `resolveLinkedCell`. Existing fallback (`lastLiteral` → `missing`) is unchanged, so a no-match linked cell degrades exactly like a blank real cell.

**Callers pass a `LookupResolver` built from the canvas nodes** (`id => nodes.find(n => n.data.properties[COLLECTION_PROP].id === id)?.…`):

- `preview.ts` `pushVarPreview` — gains a `resolve` param (callers have `nodes`). Also: **`wiredTargets` must filter `e.data.dataType === VARS_TYPE`** so a LOOKUP edge is never treated as a preview/studio target.
- `generate.ts` `buildStudioRenderItem` — gains `resolve`; the batch run resolves links per row.
- `useStudioVarBindings.ts` `unbind` — gains `resolve` (has a nodes accessor) so the freeze value follows links.
- `GridPropertyPanel.vue` — passes `resolve` for the Smart Layout write-through preview.

## 4. Canvas wiring (`CollectionNode.vue`, `VueNodeCanvas.vue`)

- **New target handle** on the Collection node: `<Handle id="lookup-in" type="target" :position="Position.Left" />`. The lookup edge is `Themes.output-0 → Players.lookup-in`, `data.dataType = LOOKUP`.
- **onConnect**: when a collection `output-0` connects to another collection's `lookup-in`, create the LOOKUP edge and register a `CollectionLink` on the **target** (driver). Match resolution: if driver and foreign share a same-named column, auto-pick it as `matchLocal`/`matchForeign`; otherwise open a small **match picker** popover ("Match `Themes.[▾]` to `Players.[▾]`").
- **Disconnect / delete**: removing the LOOKUP edge (or the foreign node) removes the corresponding `CollectionLink`.
- Guard against a collection linking to itself; a driver may have **multiple** LOOKUP edges (each contributes its columns).

New tiny component: **`LookupMatchPicker.vue`** (two selects + confirm), shown on connect when auto-match fails.

## 5. Driver drawer UX (`CollectionDrawer.vue`)

- Linked columns (`linkedColumns(collection, resolve)`) render **after** the real columns, **read-only**, with a link glyph + faint tint. Each cell = `resolveLinkedCell(...)`; **no-match → "—"**.
- The **key column** (Country) stays fully editable — it's the lookup input.
- A linked column header shows its source and an **"edit in <Foreign>"** action that opens the foreign collection's drawer (`sailor:openCollection`).
- A compact "Linked from **Themes** (Country)" chip near the toolbar makes the relationship legible; clicking it re-opens the match picker to change/clear the key.

## 6. Studio binding (`SpaceType/Gradient/Shader/Texture` surfaces)

- The **"Bind to" menu** already lists the wired collection's columns; switch its source from `collection.columns` to `effectiveColumns(collection, resolve)` so linked columns (Fill1, Text) are bindable exactly like real ones.
- Binding stores `{ collectionId: driverId, columnKey: linkedKey }`. `resolveBindings` (now lookup-aware) resolves it. **Promote is unchanged** — it only ever creates real columns on the driver.
- Live preview and batch bake already route through `resolveBindings`; once `resolve` is threaded, a bound linked column varies per driver row automatically (including the fill-swatch colors just shipped).

## 7. Edge cases

| Case | Behavior |
|---|---|
| No matching foreign row | Linked cell "—"; bound control uses frozen `lastLiteral`; run-warning strip lists unmatched keys (reuse `validateRun` surface). |
| Foreign column name collides with a driver column | Linked key namespaced; label shown as "Themes · Fill1". |
| Foreign collection deleted / edge removed | Linked columns vanish; studio bindings to them dangle → fall back to frozen value (existing dangling behavior). |
| Key column value blank | Linked cells "—". |
| Duplicate foreign keys (two France rows) | First match wins; note in the "Linked from" chip tooltip. |
| Self-link / cycle | Prevented at connect; resolution is one level only, so no recursion regardless. |

## 8. Testing

- **`lib/collection/lookup.ts` unit tests**: `linkedColumns` (basic, collision namespacing, missing foreign collection), `resolveLinkedCell` (match, no-match, blank key, missing collection), `effectiveColumns`, `findLinkedColumn`.
- **`resolveBindings` with a resolver**: binding to a linked column resolves through the join; no-match falls back to `lastLiteral`; absence of `resolve` is byte-identical to today.
- **Live in-app pass** (owed): draw the lookup edge, watch Players gain Fill1/Text, bind, scrub preview row across players, Run and confirm per-row colors.

## 9. Suggested slicing (for the implementation plan)

1. **Data + resolver core** — `types.ts` link fields, `lib/collection/lookup.ts`, `resolveBindings` 4th arg, all unit tests. Headless-verifiable, no UI. *(ships independently)*
2. **Canvas wiring** — `lookup-in` handle, onConnect/disconnect link registration, `LookupMatchPicker.vue`, `wiredTargets` dataType filter, link persistence across save/reload.
3. **Surfacing** — driver drawer linked columns, studio "Bind to" `effectiveColumns`, thread `resolve` through `pushVarPreview` / `buildStudioRenderItem` / `unbind` / `GridPropertyPanel`, live preview + batch run.

Each slice leaves the app working; slice 1 is pure and fully testable on its own.
