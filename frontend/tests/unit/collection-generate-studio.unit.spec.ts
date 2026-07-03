import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildStudioRenderItem } from '~/lib/collection/generate'
import { registerStudioParamBaker, unregisterStudioParamBaker } from '~/lib/studio/cascade'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import type { BatchItem } from '~/lib/collection/batch'
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
})
