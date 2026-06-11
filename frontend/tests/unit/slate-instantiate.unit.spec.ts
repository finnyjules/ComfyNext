import { describe, it, expect } from 'vitest'
import { instantiateSlate } from '../../app/lib/slates/instantiate'
import type { SlateTemplate } from '../../app/lib/slates/types'

const T: SlateTemplate = {
  id: 't', label: 'T', pitch: '', motion: { fps: 30, duration: 4 },
  textSlots: [{ key: 'title', label: 'Title', default: 'HELLO' }],
  mediaSlots: [{ key: 'photo', label: 'Photo' }],
  thumb: ['{{ brand.primary }}', '{{ brand.accent }}', '{{ brand.accent2 }}'],
  layers: [
    { ref: 'mask', kind: 'text', text: '{{ props.title }}', fontFamily: '{{ brand.fontDisplay }}',
      fontWeight: 900, fontSize: 0.2, color: '#ffffff', x: 0.5, y: 0.5 },
    { ref: 'panel', kind: 'media', slot: 'photo', x: 0.5, y: 0.5, w: 0.5, h: 0.5,
      maskedByRef: 'mask',
      fallbackFill: { type: 'linear', angle: 45, stops: [
        { offset: 0, color: '{{ brand.accent }}' }, { offset: 1, color: '{{ brand.accent2 }}' },
      ] },
      animation: { offset: 0.5, in: { presetId: 'grow-in', duration: 0.6 } } },
  ],
}
const BRAND = { accent: '#A3E635', accent2: '#22D3EE', fontDisplay: 'Archivo Black' }

describe('instantiateSlate', () => {
  it('resolves brand and slot tokens into concrete layers', () => {
    const { layers, motion } = instantiateSlate(T, { brand: BRAND, texts: { title: 'ADELAIDE' } })
    expect(motion).toEqual({ fps: 30, duration: 4 })
    const text = layers[0] as any
    expect(text.kind).toBe('text')
    expect(text.text).toBe('ADELAIDE')
    expect(text.fontFamily).toBe('Archivo Black')
  })
  it('maps maskedByRef to the generated layer id', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: { title: 'X' } })
    expect((layers[1] as any).maskedById).toBe((layers[0] as any).id)
  })
  it('unfilled media slot becomes a rect with the resolved fallback gradient', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: { title: 'X' } })
    const panel = layers[1] as any
    expect(panel.kind).toBe('rect')
    expect(panel.fill.stops.map((s: any) => s.color)).toEqual(['#A3E635', '#22D3EE'])
    expect(panel.animation?.in?.presetId).toBe('grow-in')
  })
  it('filled media slot becomes an image layer with the filename', () => {
    const { layers } = instantiateSlate(T, {
      brand: BRAND, texts: { title: 'X' },
      media: { photo: { filename: 'up.png', aspect: 1.5 } },
    })
    const panel = layers[1] as any
    expect(panel.kind).toBe('image')
    expect(panel.filename).toBe('up.png')
    expect(panel.maskedById).toBe((layers[0] as any).id)
  })
  it('missing slot text falls back to the slot default', () => {
    const { layers } = instantiateSlate(T, { brand: BRAND, texts: {} })
    expect((layers[0] as any).text).toBe('HELLO')
  })
  it('unresolvable brand tokens fall back to a visible neutral, not the raw token', () => {
    const { layers } = instantiateSlate(T, { brand: {}, texts: { title: 'X' } })
    expect((layers[0] as any).fontFamily).not.toContain('{{')
  })
})
