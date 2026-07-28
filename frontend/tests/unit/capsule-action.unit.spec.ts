import { describe, it, expect } from 'vitest'
import { CAPSULE_ACTIONS, capsuleAction, capsuleActionLabel, type CapsuleState } from '~/lib/canvas/capsuleAction'

const STATES: CapsuleState[] = ['ready', 'running', 'done', 'failed']

describe('capsule action table', () => {
  it('covers all four states', () => {
    expect(Object.keys(CAPSULE_ACTIONS).sort()).toEqual([...STATES].sort())
  })

  it('running stops — it does not re-run', () => {
    // The regression: the running capsule was labelled "Stop" but wired to the
    // run dispatcher, whose first line returns early while `running`. The
    // button was inert.
    expect(capsuleActionLabel('running')).toBe('Stop')
    expect(capsuleAction('running')).toBe('stop')
  })

  it('failed shows the error — it does not silently spend money on a re-run', () => {
    expect(capsuleActionLabel('failed')).toBe('Show the error')
    expect(capsuleAction('failed')).toBe('expand')
  })

  it('only the two run-labelled states dispatch a run', () => {
    const runs = STATES.filter(s => capsuleAction(s) === 'run')
    expect(runs).toEqual(['ready', 'done'])
    for (const s of runs) expect(capsuleActionLabel(s)).toMatch(/^Run/)
  })

  it('no state promises something no handler implements', () => {
    for (const s of STATES) {
      expect(['run', 'stop', 'expand']).toContain(capsuleAction(s))
      expect(capsuleActionLabel(s).length).toBeGreaterThan(0)
    }
  })
})
