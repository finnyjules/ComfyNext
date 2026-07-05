// Fill-swatch binding paths.
//
// The Type Studio's colours live inside a compound `fillList` control whose
// value is a packed JSON string (see fillTile.ts `serializeFills`). To let a
// single swatch bind to a Collection column, we address it with a synthetic
// key `<fillListKey>.<index>.<field>` (e.g. `fills.0.a`) — distinct from a flat
// `params.<key>` so the surface's `applyParam` and the run baker can route it
// into the packed value instead of writing a garbage top-level param. `field`
// is one of the Fill colour fields; only colours are bindable here.
//
// These are pure functions (no Vue, no component state) so the encode/decode
// and the read/write-into-serialized round-trip are unit-testable on their own.

import { parseFills, serializeFills } from './fillTile'

export type FillSwatchField = 'a' | 'b' | 'textColor'

/** Build the bindable key for one swatch, e.g. `fills`, 0, 'a' -> `fills.0.a`. */
export function fillSwatchKey(fillListKey: string, index: number, field: FillSwatchField): string {
  return `${fillListKey}.${index}.${field}`
}

/** Decode a key back to `{ index, field }`, or null if it isn't a swatch key
 *  for this fill list. Matches only `<fillListKey>.<int>.<a|b|textColor>` so a
 *  flat param key (`typeHeight`, `bSideColor`, …) is never mistaken for one. */
export function parseFillSwatchKey(fillListKey: string, key: string): { index: number; field: FillSwatchField } | null {
  const prefix = `${fillListKey}.`
  if (!key.startsWith(prefix)) return null
  const m = /^(\d+)\.(a|b|textColor)$/.exec(key.slice(prefix.length))
  if (!m) return null
  return { index: Number(m[1]), field: m[2] as FillSwatchField }
}

/** Read one swatch colour out of a serialized fills value. Returns null when the
 *  index is out of range (e.g. the fill was removed after the binding was made). */
export function readFillSwatch(serialized: unknown, index: number, field: FillSwatchField): string | null {
  const fills = parseFills(serialized)
  const f = fills[index]
  return f ? String(f[field] ?? '') : null
}

/** Return a new serialized fills value with one swatch colour replaced. Out-of-range
 *  indices are a no-op (the value is re-serialized unchanged) so a dangling binding
 *  can never throw or append phantom fills. Other fills/fields are preserved. */
export function writeFillSwatch(serialized: unknown, index: number, field: FillSwatchField, value: string): string {
  const fills = parseFills(serialized)
  if (index >= 0 && index < fills.length) {
    fills[index] = { ...fills[index]!, [field]: value }
  }
  return serializeFills(fills)
}
