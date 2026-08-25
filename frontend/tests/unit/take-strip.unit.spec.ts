// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TakeStrip from '~/components/vue-canvas/studio/TakeStrip.vue'
import type { VibeTake } from '~/lib/vibePrompt'

const TAKES: VibeTake[] = [
  { label: 'golden warm', rationale: 'pushes amber', changes: [{ key: 'hue', value: 30 }] },
  { label: 'soft dreamy', rationale: 'softer edges', changes: [{ key: 'softness', value: 0.8 }] },
  { label: 'both, loud', rationale: 'both at once', changes: [{ key: 'hue', value: 30 }, { key: 'softness', value: 0.9 }] },
  { label: 'restrained', rationale: 'barely there', changes: [{ key: 'softness', value: 0.3 }] },
]
const PNG = 'data:image/png;base64,iVBORw0KGgo='

function thumbsFor(takes: VibeTake[], missing: number[] = []) {
  return new Map(takes.map((t, i) => [t, missing.includes(i) ? null : `${PNG}${i}`]))
}

function mountStrip(over: Record<string, unknown> = {}) {
  return mount(TakeStrip, {
    props: { takes: TAKES, thumbs: thumbsFor(TAKES), current: PNG, ...over },
  })
}

const tiles = (w: any) => w.findAll('[data-testid="take-tile"]')

describe('TakeStrip — layout', () => {
  it('pins "yours" first, then a divider, then the takes in order', () => {
    const w = mountStrip()
    const row = w.get('[data-testid="take-row"]')
    const kids = Array.from(row.element.children) as HTMLElement[]
    expect(kids[0]!.getAttribute('data-testid')).toBe('take-yours')
    expect(kids[1]!.getAttribute('data-testid')).toBe('take-divider')
    expect(kids.slice(2).map(k => k.getAttribute('data-testid'))).toEqual(Array(4).fill('take-tile'))
  })

  it('shows every take label, in the order given', () => {
    const w = mountStrip()
    expect(tiles(w).map((t: any) => t.attributes('data-label'))).toEqual(
      ['golden warm', 'soft dreamy', 'both, loud', 'restrained'],
    )
    for (const t of TAKES) expect(w.text()).toContain(t.label)
  })

  it('renders the thumbnail it was handed for each take (no re-render of its own)', () => {
    const w = mountStrip()
    const imgs = w.findAll('[data-testid="take-tile"] img')
    expect(imgs).toHaveLength(4)
    expect(imgs[2]!.attributes('src')).toBe(`${PNG}2`)
  })

  it('a take whose thumbnail is null shows an error tile, and the strip still renders', () => {
    const w = mountStrip({ thumbs: thumbsFor(TAKES, [1]) })
    expect(tiles(w)).toHaveLength(4)
    expect(w.findAll('[data-testid="take-error"]')).toHaveLength(1)
    // The take is still selectable — only the picture failed, not the config.
    expect(tiles(w)[1]!.attributes('disabled')).toBeUndefined()
  })

  it('marks the selected take, and only it', () => {
    const w = mountStrip({ selected: TAKES[2] })
    expect(tiles(w).map((t: any) => t.attributes('data-selected'))).toEqual(['false', 'false', 'true', 'false'])
    expect(w.get('[data-testid="take-yours"]').attributes('data-selected')).toBe('false')
  })

  it('with nothing selected, "yours" reads as the current selection', () => {
    const w = mountStrip()
    expect(w.get('[data-testid="take-yours"]').attributes('data-selected')).toBe('true')
  })
})

describe('TakeStrip — emits', () => {
  it('hovering a take emits hover(take); leaving it emits hover(null)', async () => {
    const w = mountStrip()
    await tiles(w)[1]!.trigger('mouseenter')
    expect(w.emitted('hover')![0]).toEqual([TAKES[1]])
    await tiles(w)[1]!.trigger('mouseleave')
    expect(w.emitted('hover')![1]).toEqual([null])
  })

  it('hovering "yours" emits hover(null) — the original look', async () => {
    const w = mountStrip()
    await w.get('[data-testid="take-yours"]').trigger('mouseenter')
    expect(w.emitted('hover')![0]).toEqual([null])
  })

  it('clicking a take emits select(take)', async () => {
    const w = mountStrip()
    await tiles(w)[3]!.trigger('click')
    expect(w.emitted('select')![0]).toEqual([TAKES[3]])
  })

  it('clicking "yours" emits select(null) — reselect the original, strip stays open', async () => {
    const w = mountStrip({ selected: TAKES[0] })
    await w.get('[data-testid="take-yours"]').trigger('click')
    expect(w.emitted('select')![0]).toEqual([null])
    expect(w.emitted('dismiss')).toBeUndefined()
  })

  it('keep emits keep', async () => {
    const w = mountStrip({ selected: TAKES[0] })
    await w.get('[data-testid="take-keep"]').trigger('click')
    expect(w.emitted('keep')).toHaveLength(1)
  })

  it('dismiss emits dismiss', async () => {
    const w = mountStrip()
    await w.get('[data-testid="take-dismiss"]').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('Escape dismisses', async () => {
    const w = mountStrip()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await w.vm.$nextTick()
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('Escape is absorbed, so the studio behind the strip does not also close', async () => {
    const w = mountStrip()
    const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(e)
    await w.vm.$nextTick()
    expect(w.emitted('dismiss')).toHaveLength(1)
    expect(e.defaultPrevented).toBe(true)
  })

  it('going away with a take previewing emits dismiss (so the host restores)', () => {
    // The \u2715-close path: the studio unmounts the strip without anyone having
    // pressed Dismiss, and the preview must not be left applied (and then saved).
    const w = mountStrip({ selected: TAKES[0] })
    expect(w.emitted('dismiss')).toBeUndefined()
    w.unmount()
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('stops listening for Escape once unmounted (no leaked document listener)', () => {
    // Asserted on the listener itself, not on a post-unmount emit: an unmounted
    // wrapper stops recording emits, so a leaked handler would look "clean".
    const added = vi.spyOn(document, 'addEventListener')
    const removed = vi.spyOn(document, 'removeEventListener')
    const w = mountStrip()
    const handler = added.mock.calls.find(c => c[0] === 'keydown')?.[1]
    expect(handler).toBeTypeOf('function')
    w.unmount()
    expect(removed.mock.calls.some(c => c[0] === 'keydown' && c[1] === handler)).toBe(true)
    added.mockRestore(); removed.mockRestore()
  })

  it('"different directions" emits moreDirections', async () => {
    const w = mountStrip()
    await w.get('[data-testid="take-more"]').trigger('click')
    expect(w.emitted('moreDirections')).toHaveLength(1)
  })

  it('"variations of this" emits variationsOf(selected)', async () => {
    const w = mountStrip({ selected: TAKES[1] })
    await w.get('[data-testid="take-variations"]').trigger('click')
    expect(w.emitted('variationsOf')![0]).toEqual([TAKES[1]])
  })
})

describe('TakeStrip — gating', () => {
  it('keep and variations are disabled until a take is selected', () => {
    const w = mountStrip()
    expect(w.get('[data-testid="take-variations"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="take-keep"]').attributes('disabled')).toBeDefined()
    // Diverging never needs a selection.
    expect(w.get('[data-testid="take-more"]').attributes('disabled')).toBeUndefined()
  })

  it('a selection enables them', () => {
    const w = mountStrip({ selected: TAKES[0] })
    expect(w.get('[data-testid="take-variations"]').attributes('disabled')).toBeUndefined()
    expect(w.get('[data-testid="take-keep"]').attributes('disabled')).toBeUndefined()
  })

  it('a disabled variations button emits nothing when clicked', async () => {
    const w = mountStrip()
    await w.get('[data-testid="take-variations"]').trigger('click')
    expect(w.emitted('variationsOf')).toBeUndefined()
  })

  it('busy disables every action and marks the strip busy', async () => {
    const w = mountStrip({ selected: TAKES[0], busy: true })
    for (const id of ['take-more', 'take-variations', 'take-keep']) {
      expect(w.get(`[data-testid="${id}"]`).attributes('disabled')).toBeDefined()
    }
    expect(w.get('[data-testid="take-strip"]').attributes('aria-busy')).toBe('true')
  })

  it('busy suppresses hover previews (the engine is mid-render)', async () => {
    const w = mountStrip({ busy: true })
    await tiles(w)[0]!.trigger('mouseenter')
    expect(w.emitted('hover')).toBeUndefined()
  })
})

describe('TakeStrip — pending vs failed thumbnails', () => {
  it('a take with no map entry yet is PENDING, not an error', () => {
    // The strip is shown the moment takes land and thumbnails stream in after,
    // so "not drawn yet" must not read as "couldn't draw".
    const w = mountStrip({ thumbs: new Map() })
    expect(w.findAll('[data-testid="take-pending"]')).toHaveLength(4)
    expect(w.findAll('[data-testid="take-error"]')).toHaveLength(0)
  })

  it('an entry that resolved to null is the error tile', () => {
    const w = mountStrip({ thumbs: new Map([[TAKES[1]!, null]]) })
    expect(w.findAll('[data-testid="take-error"]')).toHaveLength(1)
    expect(w.findAll('[data-testid="take-pending"]')).toHaveLength(3)
  })
})

describe('TakeStrip — accessibility', () => {
  it('every tile reports its own pressed state', () => {
    const w = mountStrip({ selected: TAKES[2] })
    expect(tiles(w).map((t: any) => t.attributes('aria-pressed'))).toEqual(['false', 'false', 'true', 'false'])
    expect(w.get('[data-testid="take-yours"]').attributes('aria-pressed')).toBe('false')
  })

  it('with nothing selected, "yours" is the pressed one', () => {
    const w = mountStrip()
    expect(w.get('[data-testid="take-yours"]').attributes('aria-pressed')).toBe('true')
  })

  it('uses aria-pressed ONLY — aria-selected is not valid on a button', () => {
    // These tiles are toggle buttons, not options in a listbox/tablist. Carrying
    // both states invites them to disagree, and the second one is ignored anyway.
    const w = mountStrip({ selected: TAKES[2] })
    for (const el of [...tiles(w), w.get('[data-testid="take-yours"]')]) {
      expect((el as any).attributes('aria-selected')).toBeUndefined()
      expect((el as any).attributes('role')).toBeUndefined() // a real <button>
    }
  })

  it('every tile carries an accessible name, not just a picture', () => {
    const w = mountStrip()
    expect(tiles(w).map((t: any) => t.attributes('aria-label'))).toEqual(
      ['golden warm', 'soft dreamy', 'both, loud', 'restrained'],
    )
    expect(w.get('[data-testid="take-yours"]').attributes('aria-label')).toBe('yours')
  })

  it('keyboard focus previews exactly like hover, and blur restores', async () => {
    const w = mountStrip()
    await tiles(w)[1]!.trigger('focus')
    expect(w.emitted('hover')![0]).toEqual([TAKES[1]])
    await tiles(w)[1]!.trigger('blur')
    expect(w.emitted('hover')![1]).toEqual([null])
  })

  it('focusing "yours" previews the original', async () => {
    const w = mountStrip({ selected: TAKES[0] })
    await w.get('[data-testid="take-yours"]').trigger('focus')
    expect(w.emitted('hover')![0]).toEqual([null])
  })

  it('busy suppresses focus previews too (same guard as hover)', async () => {
    const w = mountStrip({ busy: true })
    await tiles(w)[0]!.trigger('focus')
    expect(w.emitted('hover')).toBeUndefined()
  })
})

describe('TakeStrip — variations gating', () => {
  it('canVary:false greys the button even with a selection', () => {
    const w = mountStrip({ selected: TAKES[0], canVary: false })
    expect(w.get('[data-testid="take-variations"]').attributes('disabled')).toBeDefined()
    expect(w.get('[data-testid="take-keep"]').attributes('disabled')).toBeUndefined()
  })

  it('defaults to allowed, so a host that does not pass it is unaffected', () => {
    const w = mountStrip({ selected: TAKES[0] })
    expect(w.get('[data-testid="take-variations"]').attributes('disabled')).toBeUndefined()
  })
})

describe('TakeStrip — presentation only', () => {
  it('imports nothing but its own button (no studio, config or fetch knowledge)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(`${process.cwd()}/app/components/vue-canvas/studio/TakeStrip.vue`, 'utf8')
    const imports = Array.from(src.matchAll(/from '([^']+)'/g)).map(m => m[1]!)
    for (const i of imports) {
      expect(i === 'vue' || i.endsWith('StudioButton.vue') || i === '~/lib/vibePrompt').toBe(true)
    }
    expect(src).not.toMatch(/\$fetch|useFetch|localStorage|spreadAroundTake/)
  })
})
