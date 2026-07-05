// Pure lookup-collection resolution. A driver collection's `links` point at
// foreign (lookup) collections; each contributes its non-key columns as
// read-only "linked" columns, resolved per row by matching the driver's key
// column against the foreign key column. One join, non-recursive: a linked
// cell reads a REAL foreign column, never a foreign linked column.
//
// Foreign collections arrive via a `LookupResolver` callback so this module
// stays pure — no canvas/store access.

import type { CollectionColumn, CollectionData, CollectionLink, VariableType } from './types'
import { COLLECTION_PROP } from './types'

export type LookupResolver = (collectionId: string) => CollectionData | undefined

export interface LinkedColumn {
  key: string              // namespaced, collision-free: `${collectionId}::${sourceColumnKey}`
  label: string
  type: VariableType
  sourceCollectionId: string
  sourceColumnKey: string
  matchLocal: string
  matchForeign: string
}

/** Every linked column contributed by the driver's links (foreign non-key columns).
 *  Keys are namespaced so they never collide; a label that duplicates an existing
 *  effective label is disambiguated as `${foreignName} · ${label}`. */
export function linkedColumns(local: CollectionData, resolve: LookupResolver): LinkedColumn[] {
  const out: LinkedColumn[] = []
  const usedLabels = new Set(local.columns.map(c => c.label))
  for (const link of local.links ?? []) {
    const foreign = resolve(link.collectionId)
    if (!foreign) continue
    for (const fc of foreign.columns) {
      if (fc.key === link.matchForeign) continue
      const label = usedLabels.has(fc.label) ? `${foreign.name} · ${fc.label}` : fc.label
      usedLabels.add(label)
      out.push({
        key: `${link.collectionId}::${fc.key}`,
        label,
        type: fc.type,
        sourceCollectionId: link.collectionId,
        sourceColumnKey: fc.key,
        matchLocal: link.matchLocal,
        matchForeign: link.matchForeign,
      })
    }
  }
  return out
}

/** Real columns followed by linked columns, as a flat CollectionColumn[] for bind menus. */
export function effectiveColumns(local: CollectionData, resolve: LookupResolver): CollectionColumn[] {
  const linked = linkedColumns(local, resolve).map(c => ({ key: c.key, label: c.label, type: c.type }))
  return [...local.columns, ...linked]
}

/** The LinkedColumn for a key, or null if it's a real/unknown column. */
export function findLinkedColumn(local: CollectionData, resolve: LookupResolver, key: string): LinkedColumn | null {
  return linkedColumns(local, resolve).find(c => c.key === key) ?? null
}

/** Resolve one linked cell for a driver row: match the row's `matchLocal` value
 *  against the foreign `matchForeign` column (first match), return the foreign
 *  `sourceColumnKey` cell. undefined on any miss (blank key, missing foreign
 *  collection, no match, blank foreign cell). One level only — never recurses. */
export function resolveLinkedCell(
  local: CollectionData, rowIndex: number, col: LinkedColumn, resolve: LookupResolver,
): string | number | undefined {
  const row = local.rows[rowIndex]
  if (!row) return undefined
  const keyVal = row.values[col.matchLocal]
  if (keyVal === undefined || String(keyVal).trim() === '') return undefined
  const foreign = resolve(col.sourceCollectionId)
  if (!foreign) return undefined
  const fRow = foreign.rows.find(r => String(r.values[col.matchForeign]) === String(keyVal))
  if (!fRow) return undefined
  const val = fRow.values[col.sourceColumnKey]
  return (val === undefined || String(val).trim() === '') ? undefined : val
}

/** Auto-match two column sets by shared key. Exactly one shared key → use it for
 *  both sides; 0 or >1 → null (ambiguous, defer to the match picker). */
export function autoMatchColumns(
  local: CollectionColumn[], foreign: CollectionColumn[],
): { matchLocal: string; matchForeign: string } | null {
  const foreignKeys = new Set(foreign.map(c => c.key))
  const shared = local.map(c => c.key).filter(k => foreignKeys.has(k))
  return shared.length === 1 ? { matchLocal: shared[0]!, matchForeign: shared[0]! } : null
}

/** Reconcile a driver's links against the set of source collection ids that
 *  currently have a LOOKUP edge into it. Keeps existing links (preserving their
 *  match columns) whose source still has an edge; adds a link for any new source
 *  when autoMatch yields one; drops links whose edge is gone. */
export function reconcileLinks(
  existing: CollectionLink[],
  sourceIds: string[],
  autoMatch: (sourceId: string) => { matchLocal: string; matchForeign: string } | null,
): CollectionLink[] {
  const wanted = new Set(sourceIds)
  const kept = existing.filter(l => wanted.has(l.collectionId))
  const have = new Set(kept.map(l => l.collectionId))
  const added: CollectionLink[] = []
  for (const id of sourceIds) {
    if (have.has(id)) continue
    const m = autoMatch(id)
    if (m) { added.push({ collectionId: id, ...m }); have.add(id) }
  }
  return [...kept, ...added]
}

/** Build a LookupResolver over a set of canvas nodes, keyed by each collection's data id. */
export function makeLookupResolver(collectionNodes: any[]): LookupResolver {
  return (id: string) => {
    for (const n of collectionNodes) {
      const c = n?.data?.properties?.[COLLECTION_PROP] as CollectionData | undefined
      if (c && c.id === id) return c
    }
    return undefined
  }
}
