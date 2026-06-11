import { describe, it, expect } from 'vitest'
import { SLATE_TEMPLATES, SLATE_TEMPLATES_BY_ID } from '../../app/data/slate-templates'
import { instantiateSlate } from '../../app/lib/slates/instantiate'
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '../../app/lib/motion/evaluate'

const BRAND = { primary: '#0a0a0a', accent: '#A3E635', accent2: '#22D3EE', foreground: '#ffffff', fontDisplay: 'Archivo Black', fontBody: 'Inter' }

describe('slate template catalog', () => {
  it('ships the six LIV primitives', () => {
    expect(SLATE_TEMPLATES.map(t => t.id).sort()).toEqual([
      'event-slate', 'keyline-trace', 'lower-third', 'marquee-band', 'metadata-grid', 'photo-mask-punch',
    ])
  })
  it('every template instantiates without raw tokens leaking', () => {
    for (const t of SLATE_TEMPLATES) {
      const { layers } = instantiateSlate(t, { brand: BRAND, texts: {} })
      expect(layers.length).toBeGreaterThan(0)
      for (const l of layers) expect(JSON.stringify(l)).not.toContain('{{')
    }
  })
  it('every animation preset id is supported by the engine', () => {
    for (const t of SLATE_TEMPLATES) {
      for (const def of t.layers) {
        if (def.animation?.in) expect(SUPPORTED_IN_IDS).toContain(def.animation.in.presetId)
        if (def.animation?.out) expect(SUPPORTED_OUT_IDS).toContain(def.animation.out.presetId)
        if (def.animation?.loop) expect(SUPPORTED_LOOP_IDS).toContain(def.animation.loop.presetId)
      }
    }
  })
  it('every text slot is consumed by at least one layer', () => {
    for (const t of SLATE_TEMPLATES) {
      const blob = JSON.stringify(t.layers)
      for (const slot of t.textSlots) expect(blob).toContain(`{{ props.${slot.key} }}`)
      for (const slot of t.mediaSlots) {
        expect(t.layers.some(l => l.kind === 'media' && l.slot === slot.key)).toBe(true)
      }
    }
  })
  it('lookup map matches the list', () => {
    expect(Object.keys(SLATE_TEMPLATES_BY_ID).length).toBe(SLATE_TEMPLATES.length)
  })
})
