import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { useLocalLayerEditor } from '../../app/composables/useLocalLayerEditor'

// Regression coverage for the Frame modal keyboard-edit path (handleEditorKey),
// which previously had no test. Exercises the composable end-to-end
// (selectLocal -> handleEditorKey -> nudge) with NO Vue SFC and NO canvas.
// Verified live in the browser 2026-07-05: arrow-nudge + Cmd/Ctrl+D duplicate
// fire correctly in CompositorModal at /dev/frame-lab.
function makeEditor(layers: any[]) {
  const node = reactive({ data: { properties: { sailor_localLayers: layers } } })
  const ed = useLocalLayerEditor({
    node: () => node,
    dims: () => ({ w: 680, h: 680 }),
    getRect: () => null,
  })
  return { node, ed }
}
const key = (k: string, mods: any = {}) => ({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, preventDefault() {}, ...mods })

describe('Frame nudge reproduction', () => {
  it('selectLocal populates selectedIds (the Set handleEditorKey guards on)', () => {
    const { ed } = makeEditor([{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.1, h: 0.1 }])
    ed.selectLocal('a')
    expect(ed.selectedIds.value.size).toBe(1)
  })

  it('ArrowRight nudges the selected layer to the right', () => {
    const { node, ed } = makeEditor([{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.1, h: 0.1 }])
    ed.selectLocal('a')
    const consumed = ed.handleEditorKey(key('ArrowRight') as any)
    expect(consumed).toBe(true)
    expect((node.data.properties.sailor_localLayers[0] as any).x).toBeGreaterThan(0.5)
  })

  it('ArrowUp nudges up (y decreases)', () => {
    const { node, ed } = makeEditor([{ id: 'a', kind: 'rect', x: 0.5, y: 0.5, rotation: 0, opacity: 1, w: 0.1, h: 0.1 }])
    ed.selectLocal('a')
    ed.handleEditorKey(key('ArrowUp') as any)
    expect((node.data.properties.sailor_localLayers[0] as any).y).toBeLessThan(0.5)
  })
})
