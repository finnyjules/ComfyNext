// Cartesian batch planning for Smart Layout batch export.
// Pure module — no Vue imports. See the design spec:
// docs/superpowers/specs/2026-07-11-smart-layout-batch-export-design.md

import { deriveOutputs } from '~~/shared/template-grid/resolve'
import type { CollectionData } from './types'
import { sanitize } from './generate'

export interface MatrixPoolValue { value: string; label: string }

/** One crossable axis. `key: 'format'` is the format pool; variable pools use
 *  the binding path (`props.text_layer_1`) as key. */
export interface MatrixPool {
  key: string
  label: string
  kind: 'format' | 'text' | 'image'
  values: MatrixPoolValue[]
}

export interface MatrixCombo {
  format: string
  /** Binding path → cell value (format pool excluded). */
  values: Record<string, string>
  /** Pool key → chosen value's display label (format pool included). */
  labels: Record<string, string>
  /** Stamped by the sheet via comboFilename before rendering. */
  filename?: string
}

/** Cartesian product in pool order: first pool varies slowest, last fastest.
 *  Empty pools contribute no axis (defensive — the sheet requires ≥1 each). */
export function planMatrix(pools: MatrixPool[]): MatrixCombo[] {
  const active = pools.filter(p => p.values.length > 0)
  let combos: MatrixCombo[] = [{ format: '', values: {}, labels: {} }]
  for (const pool of active) {
    const next: MatrixCombo[] = []
    for (const combo of combos) {
      for (const v of pool.values) {
        next.push({
          format: pool.key === 'format' ? v.value : combo.format,
          values: pool.key === 'format' ? combo.values : { ...combo.values, [pool.key]: v.value },
          labels: { ...combo.labels, [pool.key]: v.label },
        })
      }
    }
    combos = next
  }
  return combos
}

/** The format axis for a template: its outputs, WIDENED with any extra
 *  formats named in the node's `aspects` CSV. Legacy templates often carry a
 *  single-entry outputs list (just the master) while the aspects widget names
 *  more formats — the batch sheet should offer them all. */
export function formatPool(template: any, aspectsCsv: string): MatrixPool {
  const values: MatrixPoolValue[] = []
  const seen = new Set<string>()
  const push = (id: string, label?: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    values.push({ value: id, label: label || id })
  }
  for (const o of deriveOutputs(template, aspectsCsv)) {
    push(o.id, o.label ?? template?.formats?.[o.format]?.label)
  }
  for (const k of aspectsCsv.split(',').map(s => s.trim()).filter(Boolean)) {
    if (template?.formats?.[k]) push(k, template.formats[k]?.label)
  }
  return { key: 'format', label: 'Formats', kind: 'format', values }
}

/** Distinct, non-empty cell values of a column, in row order. */
export function columnPool(c: CollectionData, columnKey: string): MatrixPoolValue[] {
  const seen = new Set<string>()
  const out: MatrixPoolValue[] = []
  for (const row of c.rows) {
    const v = String(row.values[columnKey] ?? '').trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push({ value: v, label: v })
  }
  return out
}

/** `summer-launch_9x16_fresh-skin_bottle-2_5.png` — sanitized label parts,
 *  1-based index suffix to disambiguate collisions. */
export function comboFilename(layoutName: string, combo: MatrixCombo, index: number): string {
  const parts = [layoutName, ...Object.values(combo.labels)]
    .map(s => sanitize(s).replace(/^-+|-+$/g, ''))
    .filter(Boolean)
  return `${parts.join('_')}_${index + 1}.png`
}

// -- BatchGrid node payload ---------------------------------------------------

export const BATCH_PROP = 'sailor_batch'

export interface BatchGridItem {
  url: string
  filename: string
  format: string
  formatLabel: string
  /** Pool display label → chosen value's display label. */
  vars: Record<string, string>
}

export interface BatchGridPayload {
  createdAt: string
  sourceNodeId: string
  layoutName: string
  items: BatchGridItem[]
}

/** Pair combos with rendered urls (index-aligned), dropping failures. */
export function buildBatchPayload(
  sourceNodeId: string,
  layoutName: string,
  pools: MatrixPool[],
  combos: MatrixCombo[],
  urls: (string | undefined)[],
  createdAt: string,
): BatchGridPayload {
  const poolLabel = new Map(pools.map(p => [p.key, p.label]))
  const items: BatchGridItem[] = []
  combos.forEach((combo, i) => {
    const url = urls[i]
    if (!url) return
    const vars: Record<string, string> = {}
    for (const [key, label] of Object.entries(combo.labels)) {
      if (key === 'format') continue
      vars[poolLabel.get(key) ?? key] = label
    }
    items.push({
      url,
      filename: combo.filename ?? comboFilename(layoutName, combo, i),
      format: combo.format,
      formatLabel: combo.labels['format'] ?? combo.format,
      vars,
    })
  })
  return { createdAt, sourceNodeId, layoutName, items }
}
