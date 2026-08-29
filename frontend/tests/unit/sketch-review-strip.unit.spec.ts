// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SketchReviewStrip from '~/components/vue-canvas/SketchReviewStrip.vue'

const IMGS = ['data:img/a', 'data:img/b', 'data:img/c', 'data:img/d']
const base = (over = {}) => ({ images: IMGS, selected: null, ...over })
const tiles = (w: any) => w.findAll('[data-testid="sketch-tile"]')

describe('SketchReviewStrip — presentation', () => {
  it('renders one pure-image tile per sketch, in order', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const imgs = tiles(w).map(t => t.find('img').attributes('src'))
    expect(imgs).toEqual(IMGS)
  })
  it('bar order is Cancel then Re-roll (Keep is per-card, not in the bar)', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const ids = w.get('[data-testid="sketch-actions"]').findAll('[data-testid^="sketch-"]')
      .map(b => b.attributes('data-testid'))
    expect(ids).toEqual(['sketch-cancel', 'sketch-reroll'])
  })
  it('every sketch tile has its own Keep', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    expect(tiles(w).length).toBe(4)
    for (const t of tiles(w)) {
      const cell = t.element.closest('.group') as HTMLElement
      expect(cell.querySelector('[data-testid="sketch-keep"]')).toBeTruthy()
    }
  })
})

describe('SketchReviewStrip — emits', () => {
  it('Keep on a card selects that card then keeps it', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const keep = w.findAll('[data-testid="sketch-keep"]')[1]!
    await keep.trigger('click')
    expect(w.emitted('select')!.at(-1)).toEqual([1])
    expect(w.emitted('keep')).toHaveLength(1)
  })
  it('clicking a tile emits select(index)', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[1]!.trigger('click')
    expect(w.emitted('select')![0]).toEqual([1])
  })
  it('Keep emits keep, Cancel emits cancel, Re-roll emits reroll', async () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0 }) })
    await w.findAll('[data-testid="sketch-keep"]')[0]!.trigger('click')
    await w.get('[data-testid="sketch-cancel"]').trigger('click')
    await w.get('[data-testid="sketch-reroll"]').trigger('click')
    expect(w.emitted('keep')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('reroll')).toHaveLength(1)
  })
  it('busy disables Keep and Re-roll', () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0, busy: true }) })
    expect(w.findAll('[data-testid="sketch-keep"]')[0]!.attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="sketch-reroll"]').attributes('disabled')).toBeDefined()
  })
})

describe('SketchReviewStrip — drag to place', () => {
  it('a press-move-release past threshold emits dropAt with index + point, not select', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const tile = tiles(w)[2]!
    await tile.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
    await tile.trigger('pointermove', { clientX: 140, clientY: 180, pointerId: 1 })
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(true)
    await tile.trigger('pointerup', { clientX: 140, clientY: 180, pointerId: 1 })
    expect(w.emitted('dropAt')![0]).toEqual([{ index: 2, clientX: 140, clientY: 180 }])
    expect(w.emitted('select')).toBeUndefined()
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(false)
    w.unmount()
  })
  it('a press-release under threshold is a click (select), not a drop', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const tile = tiles(w)[0]!
    await tile.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
    await tile.trigger('pointermove', { clientX: 101, clientY: 101, pointerId: 1 })
    await tile.trigger('pointerup', { clientX: 101, clientY: 101, pointerId: 1 })
    await tile.trigger('click')
    expect(w.emitted('dropAt')).toBeUndefined()
    expect(w.emitted('select')![0]).toEqual([0])
    w.unmount()
  })
  it('the trailing click that follows a real drag is swallowed, not a select — and the guard resets for the next plain click', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const dragged = tiles(w)[1]!
    await dragged.trigger('pointerdown', { clientX: 50, clientY: 50, pointerId: 1 })
    await dragged.trigger('pointermove', { clientX: 90, clientY: 90, pointerId: 1 })
    await dragged.trigger('pointerup', { clientX: 90, clientY: 90, pointerId: 1 })
    // jsdom/happy-dom fires a trailing click after pointerup on the same element.
    await dragged.trigger('click')
    expect(w.emitted('dropAt')).toHaveLength(1)
    expect(w.emitted('select')).toBeUndefined()

    // Guard must reset per-press: a later plain click (its own pointerdown
    // rearms the guard) still selects.
    const other = tiles(w)[3]!
    await other.trigger('pointerdown', { clientX: 10, clientY: 10, pointerId: 2 })
    await other.trigger('pointerup', { clientX: 10, clientY: 10, pointerId: 2 })
    await other.trigger('click')
    expect(w.emitted('select')![0]).toEqual([3])
    w.unmount()
  })
  it('the OS stealing the gesture (pointercancel) mid-drag clears the ghost and emits no dropAt', async () => {
    const w = mount(SketchReviewStrip, { props: base(), attachTo: document.body })
    const tile = tiles(w)[2]!
    await tile.trigger('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 })
    await tile.trigger('pointermove', { clientX: 140, clientY: 180, pointerId: 1 })
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(true)
    await tile.trigger('pointercancel', { pointerId: 1 })
    expect(w.emitted('dropAt')).toBeUndefined()
    expect(w.find('[data-testid="sketch-ghost"]').exists()).toBe(false)
    w.unmount()
  })
})
