// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StudioControlPanel from '~/components/vue-canvas/studio/StudioControlPanel.vue'
import type { ControlSpec } from '~/lib/spacetype/effect'

const CONTROLS: ControlSpec[] = [
  { key: 'a', label: 'Alpha', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'One' },
  { key: 'b', label: 'Beta', kind: 'slider', min: 0, max: 1, step: 0.1, default: 0, group: 'Two', bindable: false } as ControlSpec,
]

function mountPanel(sections?: Record<string, { badge?: string; open?: boolean }>) {
  return mount(StudioControlPanel, {
    props: { controls: CONTROLS, order: ['One', 'Two'], value: () => 0, ...(sections ? { sections } : {}) },
  })
}

describe('StudioControlPanel chrome', () => {
  it('bindable:false reaches StudioRow (no bind affordance)', () => {
    const w = mountPanel()
    const rows = w.findAllComponents({ name: 'StudioRow' })
    expect(rows).toHaveLength(2)
    expect(rows[0]!.props('bindable')).toBe(true)
    expect(rows[1]!.props('bindable')).toBe(false)
  })
  it('sections prop sets badge and open on the matching StudioSection', () => {
    const w = mountPanel({ One: { badge: 'both layers', open: false } })
    const sections = w.findAllComponents({ name: 'StudioSection' })
    expect(sections[0]!.props('badge')).toBe('both layers')
    expect(sections[0]!.props('open')).toBe(false)
    expect(sections[1]!.props('open')).toBe(true) // default unchanged
  })
})

// Task 3 (option display labels): `optionLabels[i]` is presentation-only display text
// for `options[i]`. The row must SHOW the label but always EMIT/READ the raw option
// value — a stored value must never change shape because a label was added.
describe('StudioControlPanel — select optionLabels', () => {
  const SELECT_CONTROLS: ControlSpec[] = [
    {
      key: 's', label: 'Source', kind: 'select',
      options: ['none', 'shader', 'image'], optionLabels: ['None', 'Effect', 'Image'],
      default: 'none', group: 'One',
    } as ControlSpec,
  ]

  function mountSelectPanel() {
    return mount(StudioControlPanel, {
      props: { controls: SELECT_CONTROLS, order: ['One'], value: () => 'shader' },
    })
  }

  it('shows the optionLabels text for the current raw value, not the raw value itself', () => {
    const w = mountSelectPanel()
    expect(w.text()).toContain('Effect')
    expect(w.text()).not.toContain('shader')
  })

  it('emits the raw option VALUE (not the label) when the native select changes', async () => {
    const w = mountSelectPanel()
    const select = w.find('select[aria-label="Source"]')
    await select.setValue('image')
    const setEvents = w.emitted('set')
    expect(setEvents).toBeTruthy()
    expect(setEvents![setEvents!.length - 1]).toEqual(['s', 'image'])
  })
})
