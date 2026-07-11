import { deriveOutputs } from '~~/shared/template-grid/resolve'
import type { BatchItem } from './batch'
import type { CollectionData, VarBindings } from './types'
import { resolveBindings, splitRenderOverrides, splitResolvedValues } from './resolve'
import { rowLabel } from './model'
import { readTemplateFromNode } from './bindables'
import { getStudioParamBaker } from '~/lib/studio/cascade'
import { makeLookupResolver } from './lookup'
import type { MatrixCombo } from './matrix'

export function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
}

function outputFormatFor(template: unknown, outputId: string): string {
  const outputs = deriveOutputs(template as any)
  return outputs.find(o => o.id === outputId)?.format ?? outputId
}

/** Uploads a rendered blob to ComfyUI's input dir and registers it in the Assets
 * library. Shared by `buildRenderItem` and `buildStudioRenderItem` so both paths
 * stay byte-identical in their upload/import behavior. */
async function uploadAndRegister(blob: Blob, fname: string): Promise<{ rel: string; viewUrl: string }> {
  const fd = new FormData()
  fd.append('image', new File([blob], fname, { type: 'image/png' }))
  fd.append('overwrite', 'true')
  const up = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!up.ok) throw new Error('upload failed')
  const meta = await up.json() as { name?: string; subfolder?: string }
  const rel = meta.subfolder ? `${meta.subfolder}/${meta.name}` : (meta.name ?? fname)

  const importRes = await fetch('/sailor/asset_import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: rel }),
  })
  if (!importRes.ok) throw new Error('asset_import failed: ' + importRes.status)

  const viewUrl = `/view?${new URLSearchParams({
    filename: meta.name ?? fname,
    type: 'input',
    ...(meta.subfolder ? { subfolder: meta.subfolder } : {}),
  })}`
  return { rel, viewUrl }
}

/** Builds the per-item render fn for `runBatch`: resolve this row's bindings →
 * split into props/brand → POST /api/render-template → upload the PNG to
 * ComfyUI's input dir → register it in the Assets library. Throws (rather than
 * swallowing) at every network step so `runBatch` marks the item failed and
 * moves on — row isolation is `runBatch`'s job, not this fn's. */
export function buildRenderItem(
  target: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } },
  collection: CollectionData,
  bindings: VarBindings,
  runStamp: string,
): (item: BatchItem) => Promise<void> {
  return async (item: BatchItem) => {
    const template = readTemplateFromNode(target)
    if (!template) throw new Error('render failed: no template')

    const { values } = resolveBindings(collection, bindings, item.rowIndex)
    const { props, brand } = splitRenderOverrides(values)
    const aspect = outputFormatFor(template, item.outputId)

    const res = await fetch('/api/render-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, outputId: item.outputId, aspect, props, brand }),
    })
    if (!res.ok) throw new Error('render failed: ' + res.status)
    const blob = await res.blob()

    const rowLabelText = rowLabel(collection, item.rowIndex)
    const fname = `collection_${runStamp}_${sanitize(rowLabelText)}_${item.outputId}.png`
    const { rel, viewUrl } = await uploadAndRegister(blob, fname)

    item.assetName = rel
    item.url = viewUrl
  }
}

/** Builds the per-item render fn for `runBatch` when the target is a studio node
 * (Gradient/Shader/Texture/SpaceType) instead of a template-grid node: resolve this
 * row's bindings → split into param overrides → bake via the studio's registered
 * `StudioParamBaker` → upload + register exactly like `buildRenderItem`. Throws if no
 * baker is registered (studio not mounted) or the bake produced no blob, so `runBatch`
 * marks the item failed and moves on. */
export function buildStudioRenderItem(
  targetNodeId: string,
  collection: CollectionData,
  bindings: VarBindings,
  runStamp: string,
  allNodes?: any[],
): (item: BatchItem) => Promise<void> {
  return async (item: BatchItem) => {
    const resolve = allNodes ? makeLookupResolver(allNodes) : undefined
    const { values } = resolveBindings(collection, bindings, item.rowIndex, resolve)
    const { params } = splitResolvedValues(values)

    const baker = getStudioParamBaker(targetNodeId)
    if (!baker) throw new Error('studio not open — open it to generate')

    const blob = await baker(params)
    if (!blob) throw new Error('bake failed')

    const rowLabelText = rowLabel(collection, item.rowIndex)
    const fname = `collection_${runStamp}_${sanitize(rowLabelText)}_${item.outputId}.png`
    const { rel, viewUrl } = await uploadAndRegister(blob, fname)

    item.assetName = rel
    item.url = viewUrl
  }
}

/** PURE payload builder for one matrix combo: preview-row resolution is the
 *  base (non-crossed bindings keep their current values), combo values merge
 *  OVER it. Exported separately from the fetch/upload wrapper for testing. */
export function matrixRenderPayload(
  template: unknown,
  collection: CollectionData | undefined,
  bindings: VarBindings,
  combo: MatrixCombo,
): { outputId: string; aspect: string; props: Record<string, string>; brand: Record<string, string> } {
  let props: Record<string, string> = {}
  let brand: Record<string, string> = {}
  if (collection) {
    const { values } = resolveBindings(collection, bindings, collection.previewRow)
    ;({ props, brand } = splitRenderOverrides(values))
  }
  for (const [path, v] of Object.entries(combo.values)) {
    if (path.startsWith('props.')) props[path.slice(6)] = v
    else if (path.startsWith('brand.')) brand[path.slice(6)] = v
  }
  return { outputId: combo.format, aspect: outputFormatFor(template, combo.format), props, brand }
}

/** Per-item render fn for a matrix batch: `item.rowIndex` indexes `combos`.
 *  Mirrors buildRenderItem's render → upload → register flow.
 *  `templateOverride` renders an unsaved editor draft instead of the node's
 *  last-saved widget (the batch sheet passes it when opened from the modal). */
export function buildMatrixRenderItem(
  target: { data?: { widgetDefs?: { name: string }[]; widgetsValues?: unknown[] } },
  collection: CollectionData | undefined,
  bindings: VarBindings,
  combos: MatrixCombo[],
  runStamp: string,
  templateOverride?: unknown,
): (item: BatchItem) => Promise<void> {
  return async (item: BatchItem) => {
    const template = templateOverride ?? readTemplateFromNode(target)
    if (!template) throw new Error('render failed: no template')
    const combo = combos[item.rowIndex]
    if (!combo) throw new Error('render failed: no combo for item')

    const { outputId, aspect, props, brand } = matrixRenderPayload(template, collection, bindings, combo)
    const res = await fetch('/api/render-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template, outputId, aspect, props, brand }),
    })
    if (!res.ok) throw new Error('render failed: ' + res.status)
    const blob = await res.blob()

    const fname = combo.filename ?? `batch_${runStamp}_${item.rowIndex + 1}.png`
    const { viewUrl } = await uploadAndRegister(blob, fname)
    item.url = viewUrl
    item.assetName = fname
  }
}

/** v1 cost seam — free renders, flat time estimate. Swap in
 * `estimateUsdForNodes` once paid targets land. */
export function estimateBatch(itemCount: number): { label: string } {
  return { label: `${itemCount} renders · free · ~${Math.ceil(itemCount * 1.2)}s` }
}
