import { describe, it, expect } from 'vitest'
import { showIfVisible } from '../../app/lib/studio/sections'
import type { ControlSpec } from '../../app/lib/spacetype/effect'

const ctl = (showIf: any): ControlSpec =>
  ({ key: 'x', label: 'X', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'G', showIf }) as any

describe('showIfVisible in/notIn', () => {
  const read = (vals: Record<string, any>) => (k: string) => vals[k]

  it('in: visible when value is one of the list', () => {
    const c = ctl({ key: 'mode', in: ['palette', 'gradient', 'custom'] })
    expect(showIfVisible(c, read({ mode: 'gradient' }))).toBe(true)
    expect(showIfVisible(c, read({ mode: 'solid' }))).toBe(false)
  })

  it('notIn: hidden when value is one of the list', () => {
    const c = ctl({ key: 'mode', notIn: ['solid', 'grid'] })
    expect(showIfVisible(c, read({ mode: 'grid' }))).toBe(false)
    expect(showIfVisible(c, read({ mode: 'palette' }))).toBe(true)
  })

  it('still honours equals/notEquals and no-showIf', () => {
    expect(showIfVisible(ctl({ key: 'm', equals: 'on' }), read({ m: 'on' }))).toBe(true)
    expect(showIfVisible(ctl({ key: 'm', equals: 'on' }), read({ m: 'off' }))).toBe(false)
    expect(showIfVisible({ key: 'x', label: 'X', kind: 'slider', min: 0, max: 1, step: 1, default: 0, group: 'G' } as any, read({}))).toBe(true)
  })
})
