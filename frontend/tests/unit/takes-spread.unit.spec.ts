// Node env on purpose (no `window`): the SSR guard on the pick log is only
// honest when there genuinely is no window, and the spread itself is pure math.
import { afterEach, describe, expect, it } from 'vitest'
import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'
import { validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { VibeTake } from '~/lib/vibePrompt'
import {
  TAKE_LOG_MAX,
  chooseSpreadKeys,
  logTakeEvent,
  readTakeLog,
  spreadAroundTake,
} from '~/lib/agent/takes'

const CONTROLS: DescribedControl[] = [
  { path: 'softness', label: 'Softness', kind: 'slider', min: 0, max: 1, step: 0.01, current: 0.2 },
  { path: 'angle', label: 'Angle', kind: 'slider', min: 0, max: 180, step: 1, current: 10 },
  { path: 'hue', label: 'Hue', kind: 'slider', min: 0, max: 360, step: 1, current: 0 },
  { path: 'grain', label: 'Grain', kind: 'slider', min: 0, max: 100, step: 1, current: 50 },
  { path: 'mode', label: 'Mode', kind: 'select', options: ['a', 'b'], current: 'a' },
  { path: 'tint', label: 'Tint', kind: 'color', current: '#ffffff' },
]
const BASE = { softness: 0.2, angle: 10, hue: 0, grain: 50, mode: 'a', tint: '#ffffff' }

const TAKE: VibeTake = {
  label: 'soft dreamy',
  rationale: 'softer, warmer',
  changes: [
    { key: 'softness', value: 0.8 }, // Δ/range = 0.60
    { key: 'angle', value: 20 }, //     Δ/range = 0.055
    { key: 'hue', value: 5 }, //        Δ/range = 0.014
    { key: 'grain', value: 50.4 }, //   Δ/range = 0.004 — smallest, must lose
    { key: 'mode', value: 'b' }, //     non-numeric — cannot be spread
  ],
}

function valuesOf(t: VibeTake): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const c of t.changes) out[c.key] = c.value
  return out
}
const sig = (t: VibeTake) => JSON.stringify(valuesOf(t))

describe('spreadAroundTake — key choice', () => {
  it('picks the 2–3 numeric keys the take moved most, relative to their range', () => {
    // Ordered by |Δ|/range descending, capped at 3, non-numeric kinds excluded.
    expect(chooseSpreadKeys(CONTROLS, BASE, TAKE)).toEqual(['softness', 'angle', 'hue'])
  })

  it('never picks a key the take did not change', () => {
    const keys = chooseSpreadKeys(CONTROLS, BASE, {
      label: 'one knob', rationale: '', changes: [{ key: 'angle', value: 90 }],
    })
    expect(keys).toEqual(['angle'])
  })
})

describe('spreadAroundTake — output shape', () => {
  it('returns exactly four takes', () => {
    expect(spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')).toHaveLength(4)
  })

  it('is deterministic for the same seed', () => {
    const a = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    const b = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    expect(a).toEqual(b)
  })

  it('a different seed gives a different spread', () => {
    const a = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    const b = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-2')
    expect(a.map(sig)).not.toEqual(b.map(sig))
  })

  it('the four neighbours are all distinct from each other', () => {
    const out = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    expect(new Set(out.map(sig)).size).toBe(4)
  })

  it('each neighbour still differs from the take it spreads around', () => {
    const out = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    for (const n of out) expect(sig(n)).not.toBe(sig(TAKE))
  })

  it('carries the take\'s un-spread changes through (a neighbour IS the take, moved)', () => {
    const out = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')
    for (const n of out) {
      expect(valuesOf(n).mode).toBe('b') // the select the take switched
      expect(valuesOf(n).grain).toBe(50) // untouched change, snapped by validate
    }
  })
})

describe('spreadAroundTake — clamps', () => {
  it('stays inside every control range, even spreading around a value pinned at max', () => {
    const pinned: VibeTake = {
      label: 'max out', rationale: '',
      changes: [{ key: 'softness', value: 1 }, { key: 'angle', value: 0 }],
    }
    for (const n of spreadAroundTake(CONTROLS, BASE, pinned, 'edge')) {
      const v = valuesOf(n)
      expect(v.softness as number).toBeGreaterThanOrEqual(0)
      expect(v.softness as number).toBeLessThanOrEqual(1)
      expect(v.angle as number).toBeGreaterThanOrEqual(0)
      expect(v.angle as number).toBeLessThanOrEqual(180)
    }
  })

  it('is still four distinct neighbours when the take sits on a range boundary', () => {
    const pinned: VibeTake = {
      label: 'max out', rationale: '',
      changes: [{ key: 'softness', value: 1 }, { key: 'angle', value: 0 }],
    }
    expect(new Set(spreadAroundTake(CONTROLS, BASE, pinned, 'edge').map(sig)).size).toBe(4)
  })

  it('a SINGLE key pinned at its maximum still yields four distinct values', () => {
    // The mirror trick alone folds ±offset onto the same value at a boundary;
    // only the step-walk keeps the four tiles honest when one key carries them.
    const pinned: VibeTake = { label: 'max out', rationale: '', changes: [{ key: 'softness', value: 1 }] }
    const out = spreadAroundTake(CONTROLS, BASE, pinned, 'edge')
    const softness = out.map(n => valuesOf(n).softness)
    expect(new Set(softness).size).toBe(4)
    expect(softness).not.toContain(1) // never the take restated
    for (const v of softness) expect(v as number).toBeLessThanOrEqual(1)
  })

  it('every emitted value survives validatePatch unchanged (clamped AND step-snapped)', () => {
    for (const n of spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')) {
      const raw = valuesOf(n)
      expect(validatePatch(raw, CONTROLS)).toEqual(raw)
    }
  })
})

describe('spreadAroundTake — captions', () => {
  const out = spreadAroundTake(CONTROLS, BASE, TAKE, 'seed-1')

  it('names a real control label and a direction, never invented prose', () => {
    for (const n of out) {
      expect(n.label).toMatch(/Softness|Angle|Hue/)
      expect(n.label).toMatch(/[+−]/)
    }
  })

  it('keeps captions inside the strip\'s 24-character label budget', () => {
    for (const n of out) expect(n.label.length).toBeLessThanOrEqual(24)
  })

  it('the rationale states the actual before → after numbers', () => {
    for (const n of out) {
      expect(n.rationale).toContain('→')
      expect(n.rationale.toLowerCase()).toContain('soft dreamy')
    }
  })
})

describe('spreadAroundTake — degenerate input', () => {
  it('a take that changed nothing numeric still yields four distinct neighbours', () => {
    // Fallback: spread the offered sliders instead of returning four copies —
    // the button must never render four identical tiles.
    const t: VibeTake = { label: 'switch only', rationale: '', changes: [{ key: 'mode', value: 'b' }] }
    const out = spreadAroundTake(CONTROLS, BASE, t, 'seed-1')
    expect(out).toHaveLength(4)
    expect(new Set(out.map(sig)).size).toBe(4)
  })

  it('no sliders at all: returns nothing rather than four lies', () => {
    const only = CONTROLS.filter(c => c.kind !== 'slider')
    const t: VibeTake = { label: 'switch only', rationale: '', changes: [{ key: 'mode', value: 'b' }] }
    expect(spreadAroundTake(only, BASE, t, 'seed-1')).toEqual([])
  })
})

// ── pick log ────────────────────────────────────────────────────────────────
const EV = { studio: 'gradient', prompt: 'warmer', takeLabel: 'golden warm', changes: [{ key: 'hue', value: 20 }] }

function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
  }
}
function withWindow(storage: any, fn: () => void) {
  ;(globalThis as any).window = { localStorage: storage }
  try { fn() } finally { delete (globalThis as any).window }
}

afterEach(() => { delete (globalThis as any).window })

describe('pick log — SSR safety', () => {
  it('logging on the server is a no-op, not a crash', () => {
    expect(typeof (globalThis as any).window).toBe('undefined')
    expect(() => logTakeEvent({ ...EV, action: 'keep' })).not.toThrow()
  })
  it('reading on the server returns an empty log', () => {
    expect(readTakeLog()).toEqual([])
  })
})

describe('pick log — ring buffer', () => {
  it('appends events in order with a timestamp', () => {
    withWindow(fakeStorage(), () => {
      logTakeEvent({ ...EV, action: 'keep' })
      logTakeEvent({ ...EV, takeLabel: 'restrained', action: 'dismiss' })
      const log = readTakeLog()
      expect(log).toHaveLength(2)
      expect(log[0]!.takeLabel).toBe('golden warm')
      expect(log[0]!.action).toBe('keep')
      expect(log[0]!.studio).toBe('gradient')
      expect(log[0]!.prompt).toBe('warmer')
      expect(typeof log[0]!.ts).toBe('number')
      expect(log[1]!.action).toBe('dismiss')
    })
  })

  it('drops the oldest beyond the bound and keeps the newest', () => {
    withWindow(fakeStorage(), () => {
      for (let i = 0; i < TAKE_LOG_MAX + 20; i++) logTakeEvent({ ...EV, takeLabel: `t${i}`, action: 'switch' })
      const log = readTakeLog()
      expect(log).toHaveLength(TAKE_LOG_MAX)
      expect(log[0]!.takeLabel).toBe('t20')
      expect(log[log.length - 1]!.takeLabel).toBe(`t${TAKE_LOG_MAX + 19}`)
    })
  })

  it('a corrupt store reads as empty instead of throwing', () => {
    const corrupt = fakeStorage()
    corrupt.setItem('sailor.takeLog.v1', '{not json')
    withWindow(corrupt, () => {
      expect(readTakeLog()).toEqual([])
      expect(() => logTakeEvent({ ...EV, action: 'keep' })).not.toThrow()
      expect(readTakeLog()).toHaveLength(1) // recovers by starting a fresh ring
    })
  })

  it('a storage that throws (quota / private mode) does not break the studio', () => {
    const hostile = { getItem: () => { throw new Error('nope') }, setItem: () => { throw new Error('nope') }, removeItem: () => {} }
    withWindow(hostile, () => {
      expect(() => logTakeEvent({ ...EV, action: 'keep' })).not.toThrow()
      expect(readTakeLog()).toEqual([])
    })
  })
})
