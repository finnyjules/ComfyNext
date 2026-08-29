// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TakeStrip from '~/components/vue-canvas/studio/TakeStrip.vue'
import SketchReviewStrip from '~/components/vue-canvas/SketchReviewStrip.vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import type { VibeTake } from '~/lib/vibePrompt'

const TAKES: VibeTake[] = [
  { label: 'a', rationale: 'ra', changes: [] },
  { label: 'b', rationale: 'rb', changes: [] },
]
const thumbs = new Map(TAKES.map((t, i) => [t, `data:img/${i}`]))
const IMGS = ['data:img/a', 'data:img/b', 'data:img/c', 'data:img/d']

describe('review-strip parity — one tile chrome, no drift', () => {
  it('both strips render their tiles via ReviewTile', () => {
    const take = mount(TakeStrip, { props: { takes: TAKES, thumbs, current: 'data:c' } })
    const sketch = mount(SketchReviewStrip, { props: { images: IMGS, selected: null } })
    expect(take.findAllComponents(ReviewTile).length).toBe(TAKES.length)
    expect(sketch.findAllComponents(ReviewTile).length).toBe(IMGS.length)
  })
  it('a selected tile carries the identical action-blue ring in both', () => {
    const take = mount(TakeStrip, { props: { takes: TAKES, thumbs, selected: TAKES[1] } })
    const sketch = mount(SketchReviewStrip, { props: { images: IMGS, selected: 1 } })
    const ring = (w: any) => {
      const t = w.findAll('[data-testid$="-tile"]').filter((e: any) => e.attributes('data-selected') === 'true')[0]
      return t.classes().filter((c: string) => c.includes('ring') || c.includes('border-action')).sort().join(' ')
    }
    expect(ring(take)).toContain('ring-action')
    expect(ring(sketch)).toBe(ring(take))
  })
})
