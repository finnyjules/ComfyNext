import { describe, it, expect } from 'vitest'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { defaultsFromControls } from '~/lib/spacetype/effect'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'

const CONTROLS: ControlSpec[] = [
  { key: 'post.bloom', label: 'Bloom', kind: 'switch', default: false, group: 'Bloom' },
  { key: 'post.bloomStrength', label: 'Strength', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Bloom' },
]

describe('switch control kind', () => {
  it('describes a switch as AI-editable', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false, 'post.bloomStrength': 0.6 })
    const sw = d.find(x => x.path === 'post.bloom')
    expect(sw).toBeDefined()
    expect(sw!.kind).toBe('switch')
    expect(sw!.current).toBe(false)
  })

  // THE point of the kind. scene3d/controls.ts warns that a two-option select
  // would write the STRING 'on' into a BOOLEAN field and corrupt the document.
  it('validates to a real boolean, never a string', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false })
    for (const raw of [true, 'true', 'on', 1]) {
      const out = validatePatch({ 'post.bloom': raw as never }, d)
      expect(typeof out['post.bloom']).toBe('boolean')
      expect(out['post.bloom']).toBe(true)
    }
    for (const raw of [false, 'false', 'off', 0]) {
      const out = validatePatch({ 'post.bloom': raw as never }, d)
      expect(typeof out['post.bloom']).toBe('boolean')
      expect(out['post.bloom']).toBe(false)
    }
  })

  it('drops values it cannot read as a boolean', () => {
    const d = describeControls(CONTROLS, { 'post.bloom': false })
    expect(validatePatch({ 'post.bloom': 'maybe' as never }, d)).toEqual({})
  })

  it('contributes its boolean default to defaultsFromControls', () => {
    expect(defaultsFromControls(CONTROLS)['post.bloom']).toBe(false)
  })
})
