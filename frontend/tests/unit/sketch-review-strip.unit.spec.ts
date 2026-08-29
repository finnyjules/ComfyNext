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
  it('bar order is Cancel then Re-roll then Keep', () => {
    const w = mount(SketchReviewStrip, { props: base() })
    const ids = w.get('[data-testid="sketch-actions"]').findAll('[data-testid^="sketch-"]')
      .map(b => b.attributes('data-testid'))
    expect(ids).toEqual(['sketch-cancel', 'sketch-reroll', 'sketch-keep'])
  })
  it('Keep is disabled until a tile is selected', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeDefined()
    await w.setProps({ selected: 1 })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeUndefined()
  })
})

describe('SketchReviewStrip — emits', () => {
  it('hovering a tile emits hover(index); leaving emits hover(null)', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[2]!.trigger('mouseenter')
    expect(w.emitted('hover')!.at(-1)).toEqual([2])
    await tiles(w)[2]!.trigger('mouseleave')
    expect(w.emitted('hover')!.at(-1)).toEqual([null])
  })
  it('clicking a tile emits select(index)', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[1]!.trigger('click')
    expect(w.emitted('select')![0]).toEqual([1])
  })
  it('Keep emits keep, Cancel emits cancel, Re-roll emits reroll', async () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0 }) })
    await w.get('[data-testid="sketch-keep"]').trigger('click')
    await w.get('[data-testid="sketch-cancel"]').trigger('click')
    await w.get('[data-testid="sketch-reroll"]').trigger('click')
    expect(w.emitted('keep')).toHaveLength(1)
    expect(w.emitted('cancel')).toHaveLength(1)
    expect(w.emitted('reroll')).toHaveLength(1)
  })
  it('busy disables Keep and Re-roll', () => {
    const w = mount(SketchReviewStrip, { props: base({ selected: 0, busy: true }) })
    expect(w.get('[data-testid="sketch-keep"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="sketch-reroll"]').attributes('disabled')).toBeDefined()
  })
  it('the hovered tile shows a preview above it', async () => {
    const w = mount(SketchReviewStrip, { props: base() })
    await tiles(w)[0]!.trigger('mouseenter')
    expect(w.get('[data-testid="sketch-tip"]').isVisible()).toBe(true)
  })
})
