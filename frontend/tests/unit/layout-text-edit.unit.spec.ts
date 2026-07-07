import { describe, it, expect, vi } from 'vitest'
import { useLayoutTextEdit } from '~/composables/useLayoutTextEdit'
import { COLLECTION_PROP } from '~/lib/collection/types'

function fakeCtx() {
  return { patchElement: vi.fn(), template: { value: {} } } as any
}
function fakeBinding(collection: any) {
  return {
    nodeId: 'n1',
    nodesAccessor: () => [],
    edgesAccessor: () => [],
    bindings: { value: { 'props.text_layer_1': { collectionId: collection.id, columnKey: 'headline' } } },
    collectionNode: { value: { id: 'c1', data: { properties: { [COLLECTION_PROP]: collection } } } },
  } as any
}

describe('useLayoutTextEdit', () => {
  it('unbound element: commit patches literal content', () => {
    const ctx = fakeCtx()
    const { commitText } = useLayoutTextEdit(ctx, null)
    commitText({ id: 'e1', content: 'Old' }, 'New')
    expect(ctx.patchElement).toHaveBeenCalledWith('e1', { content: 'New' })
  })

  it('bound element: commit writes the preview-row cell, not the template', () => {
    const collection = {
      id: 'c1', name: 'C', columns: [{ key: 'headline', label: 'Headline', type: 'text' }],
      rows: [{ id: 'r0', values: { headline: 'A' } }, { id: 'r1', values: { headline: 'B' } }],
      previewRow: 1,
    }
    const ctx = fakeCtx()
    const { commitText } = useLayoutTextEdit(ctx, fakeBinding(collection))
    commitText({ id: 'e1', content: '{{ props.text_layer_1 }}' }, 'Edited')
    expect(collection.rows[1].values.headline).toBe('Edited') // preview row updated
    expect(collection.rows[0].values.headline).toBe('A')       // other row untouched
    expect(ctx.patchElement).not.toHaveBeenCalled()            // template token preserved
  })

  it('boundSocket returns the socket name for a bound token element', () => {
    const collection = { id: 'c1', name: 'C', columns: [], rows: [], previewRow: 0 }
    const { boundSocket } = useLayoutTextEdit(fakeCtx(), fakeBinding(collection))
    expect(boundSocket({ content: '{{ props.text_layer_1 }}' })).toBe('text_layer_1')
    expect(boundSocket({ content: 'literal' })).toBeNull()
  })
})
