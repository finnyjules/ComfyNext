import { describe, it, expect } from 'vitest'
import { SYNTHETIC_NODE_ENTRIES } from '~/composables/useNodeSearch'

describe('synthetic node entries', () => {
  it('contains the Sketch preset mapping to a schnell GenerateImageNode', () => {
    const sketch = SYNTHETIC_NODE_ENTRIES.find(e => e.name === 'Sketch')
    expect(sketch).toBeTruthy()
    expect(sketch!.displayName).toBe('Sketch')
    expect(sketch!.keywords).toEqual(expect.arrayContaining(['draft', 'fast', 'cheap', 'sketch']))
    expect(sketch!.addAs.nodeType).toBe('GenerateImageNode')
    expect(sketch!.addAs.widgetOverrides).toMatchObject({ model: 'flux-schnell' })
    expect(JSON.parse(String(sketch!.addAs.widgetOverrides!.model_options))).toMatchObject({ megapixels: '0.5' })
    expect(sketch!.addAs.propertyOverrides).toEqual({ sketch: true })
  })
})
