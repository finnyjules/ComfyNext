import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildStudioRenderItem } from '~/lib/collection/generate'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { createCollection, addColumn, addRow, setCell, addSweepRows } from '~/lib/collection/model'
import { planBatch, type BatchItem } from '~/lib/collection/batch'
import type { VarBindings } from '~/lib/collection/types'

function makeCollectionAndBindings() {
  const c = createCollection('t')
  addColumn(c, 'intensity', 'number')
  const row = addRow(c)
  setCell(c, row.id, 'intensity', 7)
  const bindings: VarBindings = {
    'params.intensity': { collectionId: c.id, columnKey: 'intensity' },
  }
  return { c, bindings, row }
}

function makeItem(rowIndex: number): BatchItem {
  return { id: 'r0:out', rowIndex, rowId: 'row0', outputId: 'out', status: 'queued' }
}

describe('buildStudioRenderItem', () => {
  const NODE_ID = 'studio-under-test'

  afterEach(() => {
    unregisterStudioParamBaker(NODE_ID)
    vi.unstubAllGlobals()
  })

  it('throws when no param baker is registered for the target node', async () => {
    const { c, bindings } = makeCollectionAndBindings()
    const renderItem = buildStudioRenderItem(NODE_ID, c, bindings, 'stamp1')
    const item = makeItem(0)
    await expect(renderItem(item)).rejects.toThrow('studio not open — open it to generate')
  })

  it('throws when the registered baker resolves to null', async () => {
    const { c, bindings } = makeCollectionAndBindings()
    registerStudioParamBaker(NODE_ID, async () => null)
    const renderItem = buildStudioRenderItem(NODE_ID, c, bindings, 'stamp1')
    const item = makeItem(0)
    await expect(renderItem(item)).rejects.toThrow('bake failed')
  })

  it('bakes with resolved param overrides, uploads, imports, and sets item.url/assetName', async () => {
    const { c, bindings } = makeCollectionAndBindings()
    let seenOverrides: Record<string, string | number> | undefined
    registerStudioParamBaker(NODE_ID, async (overrides) => {
      seenOverrides = overrides
      return new Blob(['fake-png'], { type: 'image/png' })
    })

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/upload/image') {
        return new Response(JSON.stringify({ name: 'baked.png', subfolder: 'collections' }), { status: 200 })
      }
      if (url === '/comfynext/asset_import') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error('unexpected fetch: ' + url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const renderItem = buildStudioRenderItem(NODE_ID, c, bindings, 'stamp1')
    const item = makeItem(0)
    await renderItem(item)

    expect(seenOverrides).toEqual({ intensity: 7 })
    expect(item.assetName).toBe('collections/baked.png')
    expect(item.url).toContain('filename=baked.png')
    expect(item.url).toContain('subfolder=collections')
    expect(item.url).toContain('type=input')
  })

  it('throws when the upload step fails', async () => {
    const { c, bindings } = makeCollectionAndBindings()
    registerStudioParamBaker(NODE_ID, async () => new Blob(['x'], { type: 'image/png' }))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    const renderItem = buildStudioRenderItem(NODE_ID, c, bindings, 'stamp1')
    await expect(renderItem(makeItem(0))).rejects.toThrow('upload failed')
  })

  // Regression test for the sweep-subset rowIndex bug: runRows plans a FILTERED
  // subset of rows (just the freshly-appended sweep rows) but every consumer
  // (resolveBindings included, via buildStudioRenderItem) must resolve against
  // the row's position in the FULL collection.rows, not planBatch's positional
  // index within the subset. This mirrors what CollectionDrawer.vue's runRows
  // now does: plan the subset, then remap each item's rowIndex to its absolute
  // index in collection.rows via rowId lookup.
  it('resolves the swept row (not the base row) when planning a filtered subset with remapped absolute indices', async () => {
    const { c, bindings } = makeCollectionAndBindings()
    // Base row (index 0) has intensity=7. Append sweep rows at the END of
    // collection.rows (indices 1, 2) overriding intensity to 20 and 30.
    const sweptRows = addSweepRows(c, 'intensity', [20, 30])
    expect(c.rows.length).toBe(3)
    expect(c.rows[1]!.id).toBe(sweptRows[0]!.id)
    expect(c.rows[2]!.id).toBe(sweptRows[1]!.id)

    // planBatch is called with ONLY the subset of swept rows, exactly like
    // runRows(rows, ...) does for a sweep auto-run — this assigns positional
    // rowIndex 0, 1 within the subset, NOT their true positions of 1, 2.
    const planned = planBatch(sweptRows, [{ id: 'out' }])
    expect(planned[0]!.rowIndex).toBe(0) // positional, pre-remap — wrong row!
    expect(planned[1]!.rowIndex).toBe(1)

    // Apply the same remap runRows performs: resolve each item's absolute
    // index in collection.rows via rowId lookup.
    for (const item of planned) {
      const abs = c.rows.findIndex(r => r.id === item.rowId)
      if (abs !== -1) item.rowIndex = abs
    }
    expect(planned[0]!.rowIndex).toBe(1)
    expect(planned[1]!.rowIndex).toBe(2)

    // Baker captures the params it was actually called with — assert they
    // match the SWEPT row's overridden intensity, not the base row's (7) and
    // not positionally-wrong values.
    const seenOverrides: Record<string, string | number>[] = []
    registerStudioParamBaker(NODE_ID, async (overrides) => {
      seenOverrides.push(overrides)
      return new Blob(['fake-png'], { type: 'image/png' })
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/upload/image') {
        return new Response(JSON.stringify({ name: 'baked.png', subfolder: 'collections' }), { status: 200 })
      }
      if (url === '/comfynext/asset_import') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      throw new Error('unexpected fetch: ' + url)
    }))

    const renderItem = buildStudioRenderItem(NODE_ID, c, bindings, 'stamp1')
    await renderItem(planned[0]!)
    await renderItem(planned[1]!)

    expect(seenOverrides[0]).toEqual({ intensity: 20 })
    expect(seenOverrides[1]).toEqual({ intensity: 30 })
  })
})
