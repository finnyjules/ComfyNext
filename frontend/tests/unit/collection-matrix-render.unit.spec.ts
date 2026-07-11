import { describe, expect, it } from 'vitest'
import { matrixRenderPayload } from '~/lib/collection/generate'
import { createCollection, addColumn, addRow, setCell } from '~/lib/collection/model'
import type { VarBindings } from '~/lib/collection/types'

const TEMPLATE = {
  version: 2, id: 't', name: 't', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 }, '9x16': { w: 1080, h: 1920 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#000' },
  elements: [],
}

function fixture() {
  const c = createCollection('T')
  addColumn(c, 'tag', 'text')
  addColumn(c, 'accent', 'color')
  const r = addRow(c)
  setCell(c, r.id, 'tag', 'preview tagline')
  setCell(c, r.id, 'accent', '#ff0000')
  const bindings: VarBindings = {
    'props.text_layer_1': { collectionId: c.id, columnKey: 'tag' },
    'brand.primary': { collectionId: c.id, columnKey: 'accent' },
  }
  return { c, bindings }
}

describe('matrixRenderPayload', () => {
  it('merges combo values OVER the preview-row base; brand stays from preview row', () => {
    const { c, bindings } = fixture()
    const p = matrixRenderPayload(TEMPLATE, c, bindings, {
      format: '9x16', values: { 'props.text_layer_1': 'crossed tagline' }, labels: {},
    })
    expect(p.outputId).toBe('9x16')
    expect(p.aspect).toBe('9x16')
    expect(p.props.text_layer_1).toBe('crossed tagline')   // combo wins
    expect(p.brand.primary).toBe('#ff0000')                // preview row survives
  })

  it('non-crossed bound props keep their preview-row value', () => {
    const { c, bindings } = fixture()
    const p = matrixRenderPayload(TEMPLATE, c, bindings, { format: '1x1', values: {}, labels: {} })
    expect(p.props.text_layer_1).toBe('preview tagline')
  })

  it('works with no collection at all (formats-only batch)', () => {
    const p = matrixRenderPayload(TEMPLATE, undefined, {}, { format: '1x1', values: {}, labels: {} })
    expect(p.props).toEqual({})
    expect(p.brand).toEqual({})
  })
})
