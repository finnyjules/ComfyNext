export const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

export type VariableType = 'text' | 'color' | 'number' | 'select' | 'image' | 'font'

export interface CollectionColumn {
  key: string
  label: string
  type: VariableType
  options?: string[]
}

export interface CollectionRow {
  id: string
  sweep?: boolean
  values: Record<string, string | number>
}

export interface CollectionData {
  id: string
  name: string
  columns: CollectionColumn[]
  rows: CollectionRow[]
  previewRow: number
  links?: CollectionLink[]
}

/** One lookup link on a driver collection: match this collection's `matchLocal`
 *  column against the foreign collection's `matchForeign` key column. */
export interface CollectionLink {
  collectionId: string
  matchLocal: string
  matchForeign: string
}

/** One control binding on a target node: which collection column feeds it. */
export interface VarBinding {
  collectionId: string
  columnKey: string
  /** Discriminator: undefined or 'collection' = data-merge binding; 'reference' = @refs binding. */
  kind?: 'collection' | 'reference'
  /** Bare reference handle when kind === 'reference'. */
  refName?: string
  /** Last literal value, used when the binding dangles (deleted column/collection). */
  lastLiteral?: string | number
}

/** Keyed by bindable path, e.g. 'props.text_layer_1' or 'brand.primary'. */
export type VarBindings = Record<string, VarBinding>

export const COLLECTION_PROP = 'sailor_collection'
export const BINDINGS_PROP = 'sailor_varBindings'
export const VAR_PREVIEW_PROP = 'sailor_varPreview'
export const VARS_TYPE = 'VARS'
export const LOOKUP_TYPE = 'LOOKUP'
