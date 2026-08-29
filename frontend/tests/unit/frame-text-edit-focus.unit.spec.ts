import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { useLocalLayerEditor } from '../../app/composables/useLocalLayerEditor'

// The focus contract behind "Add text, then just type".
// `beginEdit` only sets `editingId`; the <textarea> lives in the host (the Frame
// card, the Compositor modal), so the editor asks the host for the element and
// focuses + selects it once the DOM has caught up. Both hosts register the same
// way, which is why the two surfaces can't drift apart again.
function makeEditor(layers: any[] = []) {
  const node = reactive({ data: { properties: { sailor_localLayers: layers } } })
  const ed = useLocalLayerEditor({
    node: () => node,
    dims: () => ({ w: 680, h: 680 }),
    getRect: () => null,
  })
  return { node, ed }
}
function fakeTextarea() {
  return { focus: vi.fn(), select: vi.fn() } as unknown as HTMLTextAreaElement
}
// The host's textarea only exists while a text layer is being edited (v-if), so
// the fake getter mirrors that: null until `editingId` is set.
const settle = async () => { await nextTick(); await nextTick(); await nextTick() }

describe('inline text editor focus contract', () => {
  it('beginEdit focuses and select-alls the host textarea', async () => {
    const { ed } = makeEditor([{ id: 't1', kind: 'text', text: 'Text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.1 }])
    const el = fakeTextarea()
    ed.registerEditFocus(() => (ed.editingId.value ? el : null))
    ed.beginEdit('t1')
    await settle()
    expect(el.focus).toHaveBeenCalledTimes(1)
    expect(el.select).toHaveBeenCalledTimes(1)
  })

  it('addText focuses too — the "type immediately" path', async () => {
    const { ed } = makeEditor([])
    const el = fakeTextarea()
    ed.registerEditFocus(() => (ed.editingId.value ? el : null))
    ed.addText()
    await settle()
    expect(ed.editingId.value).toBeTruthy()
    expect(el.focus).toHaveBeenCalledTimes(1)
    expect(el.select).toHaveBeenCalledTimes(1)
  })

  it('waits a tick for a host that renders the textarea late (the card gates it on edit mode)', async () => {
    const { ed } = makeEditor([{ id: 't1', kind: 'text', text: 'Text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.1 }])
    const el = fakeTextarea()
    let mounted = false
    ed.registerEditFocus(() => (mounted ? el : null))
    ed.beginEdit('t1')
    await nextTick()
    mounted = true // host's own render lands one tick later
    await settle()
    expect(el.focus).toHaveBeenCalled()
  })

  it('endEdit does not re-focus', async () => {
    const { ed } = makeEditor([{ id: 't1', kind: 'text', text: 'Text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.1 }])
    const el = fakeTextarea()
    ed.registerEditFocus(() => el)
    ed.beginEdit('t1')
    await settle()
    ;(el.focus as any).mockClear()
    ed.endEdit()
    await settle()
    expect(el.focus).not.toHaveBeenCalled()
  })

  it('no registered host is harmless (nothing throws)', async () => {
    const { ed } = makeEditor([{ id: 't1', kind: 'text', text: 'Text', x: 0.5, y: 0.5, rotation: 0, opacity: 1, fontSize: 0.1 }])
    ed.beginEdit('t1')
    await settle()
    expect(ed.editingId.value).toBe('t1')
  })
})
