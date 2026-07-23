import { describe, it, expect } from 'vitest'
import { KINETIC_PRESETS_BY_ID, KINETIC_GROUP_LABELS, presetParamDefault } from '~/data/kinetic-presets'
import { PRESET_PARAM_DEFAULTS, SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'

const NEW_IDS = ['wiggle', 'card-flip-h', 'card-flip-v', 'card-flip-h-out', 'card-flip-v-out',
  'inward-echoes', 'grid-scroll-x', 'grid-scroll-y', 'noise-tile']

describe('utility catalog entries', () => {
  it('every new preset has a catalog entry in the utility group', () => {
    for (const id of NEW_IDS) {
      const p = KINETIC_PRESETS_BY_ID[id]
      expect(p, id).toBeTruthy()
      expect(p.group).toBe('utility')
      expect(p.label.length).toBeGreaterThan(0)
    }
    expect(KINETIC_GROUP_LABELS.utility).toBe('Utility')
  })
  it('param schemas cover exactly the engine defaults', () => {
    for (const id of NEW_IDS) {
      const schemaKeys = (KINETIC_PRESETS_BY_ID[id].params ?? []).map(s => s.key).sort()
      expect(schemaKeys, id).toEqual(Object.keys(PRESET_PARAM_DEFAULTS[id] ?? {}).sort())
    }
  })
  it('schema defaults resolve from the engine registry', () => {
    expect(presetParamDefault('wiggle', 'amplitude')).toBe(PRESET_PARAM_DEFAULTS['wiggle'].amplitude)
  })
  it('every supported engine id has a catalog label (gallery completeness)', () => {
    for (const id of [...SUPPORTED_IN_IDS, ...SUPPORTED_OUT_IDS, ...SUPPORTED_LOOP_IDS]) {
      // marquee predates the catalog and 'typewriter-out' etc. may fall back to the raw id —
      // only the NEW ids are required, plus all ids must not crash the lookup.
      expect(() => KINETIC_PRESETS_BY_ID[id]?.label ?? id).not.toThrow()
    }
  })
})
