import { describe, it, expect } from 'vitest'
import type { UnitState, UnitCopy } from '~/lib/motion/evaluate'
import { IDENTITY_UNIT } from '~/lib/motion/evaluate'
import { composeEffectiveLayer } from '~/lib/motion/paint'
import { drawAnimatedTextLayer } from '~/lib/motion/animatedText'
import { createRectLayer, createTextLayer } from '~/composables/useCompositorLayers'

describe('UnitState extensions', () => {
  it('accepts scaleX/scaleY and copies (types compile, identity has none)', () => {
    const copy: UnitCopy = { dx: 1, dy: 0, scale: 1.2, opacity: 0.5 }
    const st: UnitState = { ...IDENTITY_UNIT, scaleX: 0.5, scaleY: 1, copies: [copy] }
    expect(st.scaleX).toBe(0.5)
    expect(st.copies).toHaveLength(1)
    expect((IDENTITY_UNIT as UnitState).scaleX).toBeUndefined()
  })

  it('accepts axes and blur (types compile, identity has neither)', () => {
    const st: UnitState = { ...IDENTITY_UNIT, axes: { wght: -300, GRAD: 40 }, blur: 0.25 }
    expect(st.axes!.wght).toBe(-300)
    expect(st.blur).toBe(0.25)
    expect((IDENTITY_UNIT as UnitState).axes).toBeUndefined()
    expect((IDENTITY_UNIT as UnitState).blur).toBeUndefined()
  })
})

// The Compositor is a *consumer* of UnitState, not an owner: it must ignore
// fields it doesn't implement rather than mis-render them. Blur on Compositor
// layers is explicitly out of scope, so the bar here is "identical output",
// not "blurred output".
describe('Compositor consumers ignore axes/blur', () => {
  it('composeEffectiveLayer produces an identical layer with and without them', () => {
    const base = createRectLayer({ x: 0.4, y: 0.6, rotation: 12, opacity: 0.7, w: 0.2, h: 0.1 })
    const plain: UnitState = { ...IDENTITY_UNIT, dx: 0.3, dy: -0.2, opacity: 0.5, rotation: 4 }
    const extended: UnitState = { ...plain, axes: { wght: 700 }, blur: 3 }
    const state = (u: UnitState) => ({ visible: true, layer: IDENTITY_UNIT, units: [u] })
    expect(composeEffectiveLayer(base, state(extended), 1000, 800))
      .toEqual(composeEffectiveLayer(base, state(plain), 1000, 800))
  })

  it('drawAnimatedTextLayer emits the same canvas calls and never sets ctx.filter', () => {
    const layer = createTextLayer({ text: 'AB', x: 0.5, y: 0.5, fontSize: 0.1, lineHeight: 1.2, align: 'center' })
    const record = (units: UnitState[]) => {
      const log: string[] = []
      const ctx = new Proxy({} as Record<string, unknown>, {
        get(_t, key: string) {
          if (key === 'measureText') return (s: string) => ({ width: s.length * 10 })
          if (key === 'canvas') return undefined
          return (...args: unknown[]) => { log.push(`${key}(${args.join(',')})`) }
        },
        set(_t, key: string, value: unknown) { log.push(`${key}=${String(value)}`); return true },
      }) as unknown as CanvasRenderingContext2D
      drawAnimatedTextLayer(ctx, layer, 1000, 800, units)
      return log
    }
    const plain: UnitState[] = [{ ...IDENTITY_UNIT, dy: 0.4 }, { ...IDENTITY_UNIT, dy: 0.2 }]
    const extended: UnitState[] = plain.map(u => ({ ...u, axes: { wght: 900 }, blur: 5 }))
    const withExtras = record(extended)
    // Guard against a vacuous pass: the stub must actually have drawn.
    expect(withExtras.filter(entry => entry.startsWith('fillText'))).toHaveLength(2)
    expect(withExtras).toEqual(record(plain))
    expect(withExtras.some(entry => entry.startsWith('filter'))).toBe(false)
  })
})
