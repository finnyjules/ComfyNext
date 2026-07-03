import { deriveOutputs } from '~~/shared/template-grid/resolve'
import type { BatchItem } from './batch'
import type { CollectionData, VarBindings } from './types'
import { resolveBindings, splitRenderOverrides } from './resolve'
import { rowLabel } from './model'
import { readTemplateFromNode } from './bindables'

export function sanitize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
}

function outputFormatFor(template: unknown, outputId: string): string {
  const outputs = deriveOutputs(template as any)
  return outputs.find(o => o.id === outputId)?.format ?? outputId
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
    const fd = new FormData()
    fd.append('image', new File([blob], fname, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const up = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!up.ok) throw new Error('upload failed')
    const meta = await up.json() as { name?: string; subfolder?: string }
    const rel = meta.subfolder ? `${meta.subfolder}/${meta.name}` : (meta.name ?? fname)

    const importRes = await fetch('/comfynext/asset_import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel }),
    })
    if (!importRes.ok) throw new Error('asset_import failed: ' + importRes.status)

    item.assetName = rel
    item.url = `/view?${new URLSearchParams({
      filename: meta.name ?? fname,
      type: 'input',
      ...(meta.subfolder ? { subfolder: meta.subfolder } : {}),
    })}`
  }
}

/** v1 cost seam — free renders, flat time estimate. Swap in
 * `estimateUsdForNodes` once paid targets land. */
export function estimateBatch(itemCount: number): { label: string } {
  return { label: `${itemCount} renders · free · ~${Math.ceil(itemCount * 1.2)}s` }
}
