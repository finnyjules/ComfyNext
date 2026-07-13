import { describe, expect, it, vi, beforeEach } from 'vitest'

// Capture the wiring img-fx's core receives so we can drive the phase machine
// the composable listens to. The real engine is WebGL/rAF and lives in the
// browser; here we assert the composable calls the core correctly and reacts to
// phase transitions (boil-on-visible, reveal-resolves-on-visible). vi.hoisted so
// these exist when the hoisted vi.mock factory runs.
const H = vi.hoisted(() => {
  const inst = { __tag: 'inst' }
  const reveal = { dispose: vi.fn(), __tag: 'reveal' }
  const cycle = { setImages: vi.fn(), triggerOnce: vi.fn(), triggerBoil: vi.fn(), stop: vi.fn(), dispose: vi.fn() }
  const state: { onPhase: ((e: { phase: string }) => void) | null } = { onPhase: null }
  return {
    inst, reveal, cycle, state,
    createInstance: vi.fn(() => inst),
    createReveal: vi.fn(() => reveal),
    createCycle: vi.fn((opts: any) => { state.onPhase = opts.onPhase; return cycle }),
    destroyInstance: vi.fn(),
    setInstanceVisible: vi.fn(),
    setInstancePaused: vi.fn(),
    setInstancePreset: vi.fn(),
    updateInstanceSize: vi.fn(),
  }
})
const { inst, reveal, cycle } = H
const emitPhase = (phase: string) => H.state.onPhase!({ phase })

vi.mock('img-fx', () => {
  const mode = (theme: string) => ({ theme, effectIndex: 22, colors: [], alphas: [], cardBg: '#0f0f0f' })
  return {
    createInstance: H.createInstance, createReveal: H.createReveal, createCycle: H.createCycle,
    destroyInstance: H.destroyInstance, setInstanceVisible: H.setInstanceVisible,
    setInstancePaused: H.setInstancePaused,
    setInstancePreset: H.setInstancePreset, updateInstanceSize: H.updateInstanceSize,
    PRESETS: {
      'pixels-organic': { name: 'pixels-organic', modes: { dark: mode('dark'), light: mode('light') } },
      'pixels-mechanic': { name: 'pixels-mechanic', modes: { dark: mode('dark'), light: mode('light') } },
      'sweep-gradient': { name: 'sweep-gradient', modes: { dark: mode('dark'), light: mode('light') } },
    },
  }
})

// Node env has no ResizeObserver / DOM element — stub what mount() touches.
class FakeRO { observe = vi.fn(); disconnect = vi.fn() }
;(globalThis as any).ResizeObserver = FakeRO

function fakeCanvas() { return {} as unknown as HTMLCanvasElement }
function fakeFrame() {
  return { getBoundingClientRect: () => ({ width: 320, height: 320 }) } as unknown as HTMLElement
}

import { useImgFx } from '~/composables/useImgFx'

function mounted() {
  const fx = useImgFx()
  fx.mount(fakeCanvas(), fakeCanvas(), fakeFrame(), { preset: 'pixels-organic', theme: 'dark' })
  return fx
}

beforeEach(() => {
  vi.clearAllMocks()
  H.state.onPhase = null
})

describe('useImgFx', () => {
  it('mounts the engine with the resolved preset mode and marks it visible', () => {
    const fx = mounted()
    expect(fx.isMounted()).toBe(true)
    expect(H.createInstance).toHaveBeenCalledTimes(1)
    const arg = H.createInstance.mock.calls[0]![0] as any
    expect(arg.cssWidth).toBe(320)
    expect(arg.preset.theme).toBe('dark')
    expect(H.createReveal).toHaveBeenCalledTimes(1)
    expect(H.createCycle).toHaveBeenCalledTimes(1)
    expect(H.setInstanceVisible).toHaveBeenCalledWith(inst, true)
  })

  it('revealResult dissolves the new image in and resolves once it is held', async () => {
    const fx = mounted()
    let done = false
    const p = fx.revealResult('/new.png').then(() => { done = true })
    expect(cycle.setImages).toHaveBeenCalledWith(['/new.png'])
    expect(cycle.triggerOnce).toHaveBeenCalledWith({ hold: 'manual' })
    expect(done).toBe(false)
    // Engine drives the reveal to completion: reveal → visible.
    emitPhase('reveal')
    emitPhase('visible')
    await p
    expect(done).toBe(true)
    expect(cycle.triggerBoil).not.toHaveBeenCalled()
  })

  it('boilFrom holds the existing image (onHeld), then boils it a beat later', () => {
    vi.useFakeTimers()
    try {
      const fx = mounted()
      let held = false
      fx.boilFrom('/old.png', () => { held = true })
      expect(cycle.setImages).toHaveBeenCalledWith(['/old.png'])
      expect(cycle.triggerOnce).toHaveBeenCalledWith({ hold: 'manual' })
      // Seeds with a near-instant reveal so the existing image is held fast.
      const seedMode = H.setInstancePreset.mock.calls.at(-1)![1] as any
      expect(seedMode.revealConfig.duration).toBe(0.12)
      expect(held).toBe(false)
      // Held → onHeld fires (caller reveals fx), normal reveal restored, boil is
      // DEFERRED a beat so the old image is visibly present before it breaks apart.
      emitPhase('reveal'); emitPhase('visible')
      expect(held).toBe(true)
      const restored = H.setInstancePreset.mock.calls.at(-1)![1] as any
      expect(restored.revealConfig?.duration).toBeUndefined()   // back to the base mode
      expect(cycle.triggerBoil).not.toHaveBeenCalled()
      vi.advanceTimersByTime(400)
      expect(cycle.triggerBoil).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stalled boil does not hijack a later reveal — the reveal still resolves', async () => {
    const fx = mounted()
    // Boil the old image, but its reveal never reaches 'visible' (e.g. the image
    // failed to load) — the boil-on-visible intent must NOT leak into the next op.
    fx.boilFrom('/old.png')
    // New result arrives and reveals; on 'visible' it must RESOLVE, not boil.
    let done = false
    const p = fx.revealResult('/new.png').then(() => { done = true })
    emitPhase('reveal')
    emitPhase('visible')
    await p
    expect(done).toBe(true)
    expect(cycle.triggerBoil).not.toHaveBeenCalled()
  })

  it('revealResult resolves even if the engine never reaches "visible" (safety timeout)', async () => {
    vi.useFakeTimers()
    try {
      const fx = mounted()
      let done = false
      const p = fx.revealResult('/new.png').then(() => { done = true })
      await vi.advanceTimersByTimeAsync(10_000)   // no phase ever emitted
      await p
      expect(done).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('idle() pauses+resets but keeps the instance mounted (no dispose — renderer stays alive)', () => {
    const fx = mounted()
    fx.idle()
    expect(H.setInstancePaused).toHaveBeenCalledWith(inst, true)
    expect(cycle.stop).toHaveBeenCalled()        // reset() ran
    expect(H.destroyInstance).not.toHaveBeenCalled()
    expect(fx.isMounted()).toBe(true)
    // churn() unpauses again for the next generation.
    fx.churn()
    expect(H.setInstancePaused).toHaveBeenCalledWith(inst, false)
    expect(H.setInstanceVisible).toHaveBeenCalledWith(inst, true)
  })

  it('dispose releases the cycle, reveal and GL instance', () => {
    const fx = mounted()
    fx.dispose()
    expect(cycle.dispose).toHaveBeenCalledTimes(1)
    expect(reveal.dispose).toHaveBeenCalledTimes(1)
    expect(H.destroyInstance).toHaveBeenCalledWith(inst)
    expect(fx.isMounted()).toBe(false)
  })

  it('is reusable across generations — mounts again after dispose (re-roll)', () => {
    const fx = mounted()
    expect(fx.isMounted()).toBe(true)
    fx.dispose()
    expect(fx.isMounted()).toBe(false)
    // A later re-roll must be able to mount a fresh engine (the `disposed` latch
    // used to block this permanently, breaking the effect on every re-roll).
    fx.mount(fakeCanvas(), fakeCanvas(), fakeFrame(), { preset: 'pixels-organic', theme: 'dark' })
    expect(fx.isMounted()).toBe(true)
    expect(H.createInstance).toHaveBeenCalledTimes(2)
  })

  it('reset() drops the held reveal (cycle.stop) so the next boil starts idle', () => {
    const fx = mounted()
    // Simulate a held result from the previous generation.
    fx.revealResult('/old.png')
    emitPhase('reveal'); emitPhase('visible')
    vi.clearAllMocks()
    fx.reset()
    expect(cycle.stop).toHaveBeenCalledTimes(1)
    // After reset the phase is idle again → boilFrom actually fires (not a no-op).
    fx.boilFrom('/current.png')
    expect(cycle.setImages).toHaveBeenCalledWith(['/current.png'])
    expect(cycle.triggerOnce).toHaveBeenCalledWith({ hold: 'manual' })
  })

  it('is a no-op (no throw) when methods are called before mount', async () => {
    const fx = useImgFx()
    expect(fx.isMounted()).toBe(false)
    await expect(fx.revealResult('/x.png')).resolves.toBeUndefined()
    expect(cycle.triggerOnce).not.toHaveBeenCalled()
    fx.dispose()
  })
})
