import { describe, it, expect } from 'vitest'
import { mapControlSpecToDesc } from '~/lib/collection/studioControls'

describe('mapControlSpecToDesc', () => {
  it('maps a slider ControlSpec, carrying min/max/step', () => {
    const spec = { key: 'flow.intensity', label: 'Intensity', kind: 'slider', min: 0, max: 100, step: 1, default: 0, group: 'Flow' } as const
    expect(mapControlSpecToDesc(spec)).toEqual({ key: 'flow.intensity', label: 'Intensity', kind: 'slider', min: 0, max: 100, step: 1 })
  })

  it('maps a select ControlSpec, carrying a copy of options', () => {
    const spec = { key: 'canvas.layout', label: 'Layout', kind: 'select', options: ['linear', 'radial'], default: 'linear', group: 'Canvas' } as const
    const desc = mapControlSpecToDesc(spec)
    expect(desc).toEqual({ key: 'canvas.layout', label: 'Layout', kind: 'select', options: ['linear', 'radial'] })
    // Defensive copy — mutating the source array must not leak into the mapped desc.
    expect(desc.options).not.toBe(spec.options)
  })

  it('maps a color ControlSpec with no extra fields', () => {
    const spec = { key: 'canvas.background', label: 'Background', kind: 'color', default: '#000000', group: 'Canvas' } as const
    expect(mapControlSpecToDesc(spec)).toEqual({ key: 'canvas.background', label: 'Background', kind: 'color' })
  })

  it('maps a non-bindable kind (text) through with just key/label/kind', () => {
    const spec = { key: 'label', label: 'Label', kind: 'text', default: '', group: 'Content' } as const
    expect(mapControlSpecToDesc(spec)).toEqual({ key: 'label', label: 'Label', kind: 'text' })
  })
})

describe('ShapeStudio', () => {
  it('resolves bindable controls for a ShapeStudio node', async () => {
    const { controlsForStudio } = await import('~/lib/collection/studioControls')
    const node: any = { data: { nodeType: 'ShapeStudio', properties: {} } }
    const descs = await controlsForStudio(node)
    expect(descs.length).toBeGreaterThan(0)
    expect(descs.map((d) => d.key)).toContain('shape.jitter')
  })

  it('is a vars target, so the node renders its VARS input port', async () => {
    // ShapeStudioNode.vue already computes varsInputIndex and renders the port
    // v-if="varsInputIndex >= 0" — it was dead code until this registration.
    const { VARS_TARGET_NODE_TYPES } = await import('~/lib/collection/varsInput')
    expect(VARS_TARGET_NODE_TYPES.has('ShapeStudio')).toBe(true)
  })
})
