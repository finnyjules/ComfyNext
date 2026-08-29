// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'

const mountTile = (props = {}, slots = {}) =>
  mount(ReviewTile, { props: { tileTestid: 'x-tile', ...props }, slots })

describe('ReviewTile — chrome', () => {
  it('renders default slot inside a button carrying the given testid', () => {
    const w = mountTile({}, { default: '<img src="a">' })
    const btn = w.get('[data-testid="x-tile"]')
    expect(btn.element.tagName).toBe('BUTTON')
    expect(btn.find('img').attributes('src')).toBe('a')
  })
  it('selected toggles the action-blue ring and the forced-reveal on the overlay', () => {
    const on = mountTile({ selected: true }, { actions: '<button>Keep</button>' })
    const tile = on.get('[data-testid="x-tile"]')
    expect(tile.classes().join(' ')).toContain('ring-action')
    // the overlay wrapping #actions is forced open when selected
    const overlay = on.get('[data-testid="x-tile-actions"]')
    expect(overlay.classes()).toContain('!opacity-100')
    const off = mountTile({ selected: false }, { actions: '<button>Keep</button>' })
    expect(off.get('[data-testid="x-tile"]').classes().join(' ')).not.toContain('ring-action')
    expect(off.get('[data-testid="x-tile-actions"]').classes()).not.toContain('!opacity-100')
  })
  it('data-selected + aria-pressed track selected', () => {
    const w = mountTile({ selected: true })
    const t = w.get('[data-testid="x-tile"]')
    expect(t.attributes('data-selected')).toBe('true')
    expect(t.attributes('aria-pressed')).toBe('true')
  })
  it('label sets data-label + aria-label; absent when no label', () => {
    const withL = mountTile({ label: 'golden warm' }).get('[data-testid="x-tile"]')
    expect(withL.attributes('data-label')).toBe('golden warm')
    expect(withL.attributes('aria-label')).toBe('golden warm')
    const noL = mountTile().get('[data-testid="x-tile"]')
    expect(noL.attributes('aria-label')).toBeUndefined()
  })
  it('no #actions slot => no overlay', () => {
    const w = mountTile()
    expect(w.find('[data-testid="x-tile-actions"]').exists()).toBe(false)
  })
})

describe('ReviewTile — focus forwarding', () => {
  it('button focus/blur emit tilefocus/tileblur', async () => {
    const w = mountTile()
    const t = w.get('[data-testid="x-tile"]')
    await t.trigger('focus')
    await t.trigger('blur')
    expect(w.emitted('tilefocus')).toHaveLength(1)
    expect(w.emitted('tileblur')).toHaveLength(1)
  })
})

describe('ReviewTile — drag (opt-in)', () => {
  it('with draggable, pointer events forward the PointerEvent', async () => {
    const w = mountTile({ draggable: true }, { default: '<img src="a">' })
    const t = w.get('[data-testid="x-tile"]')
    await t.trigger('pointerdown', { clientX: 1, clientY: 1, pointerId: 7 })
    await t.trigger('pointermove', { clientX: 9, clientY: 9, pointerId: 7 })
    await t.trigger('pointerup', { clientX: 9, clientY: 9, pointerId: 7 })
    await t.trigger('pointercancel', { pointerId: 7 })
    expect(w.emitted('tilepointerdown')).toHaveLength(1)
    expect(w.emitted('tilepointermove')).toHaveLength(1)
    expect(w.emitted('tilepointerup')).toHaveLength(1)
    expect(w.emitted('tilepointercancel')).toHaveLength(1)
    expect((w.emitted('tilepointerdown')![0][0] as PointerEvent).clientX).toBe(1)
  })
  it('without draggable, pointer events do NOT emit', async () => {
    const w = mountTile({ draggable: false })
    await w.get('[data-testid="x-tile"]').trigger('pointerdown', { pointerId: 1 })
    expect(w.emitted('tilepointerdown')).toBeUndefined()
  })
})
