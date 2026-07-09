import { describe, expect, it, beforeEach } from 'vitest'
import {
  reserve, releaseReservation, registerRun, inFlight, clearAllRuns, inFlightCount,
} from '~/lib/graph/runRegistry'

beforeEach(() => {
  clearAllRuns()
})

describe('reserve', () => {
  it('makes inFlight({worker}) reflect the reservation with zero registered runs', () => {
    reserve(0)
    expect(inFlight({ worker: 0 }).length).toBe(1)
    expect(inFlight().length).toBe(1)
  })

  it('two reserves for the same worker stack', () => {
    reserve(0)
    reserve(0)
    expect(inFlight({ worker: 0 }).length).toBe(2)
    expect(inFlight().length).toBe(2)
  })

  it('reserves for different workers are counted independently', () => {
    reserve(0)
    reserve(1)
    expect(inFlight({ worker: 0 }).length).toBe(1)
    expect(inFlight({ worker: 1 }).length).toBe(1)
    expect(inFlight().length).toBe(2)
  })

  it('does not affect inFlight({tabId}) filtering — reservations have no tabId', () => {
    reserve(0)
    expect(inFlight({ tabId: 'tabA' }).length).toBe(0)
  })

  it('bumps inFlightCount', () => {
    expect(inFlightCount.value).toBe(0)
    reserve(0)
    expect(inFlightCount.value).toBe(1)
  })
})

describe('releaseReservation', () => {
  it('drops the reservation count', () => {
    const id = reserve(0)
    expect(inFlight({ worker: 0 }).length).toBe(1)
    releaseReservation(id)
    expect(inFlight({ worker: 0 }).length).toBe(0)
    expect(inFlight().length).toBe(0)
  })

  it('only releases the targeted reservation, leaving others intact', () => {
    const id1 = reserve(0)
    reserve(0)
    releaseReservation(id1)
    expect(inFlight({ worker: 0 }).length).toBe(1)
  })

  it('is a no-op for an unknown id', () => {
    reserve(0)
    expect(() => releaseReservation(999999)).not.toThrow()
    expect(inFlight({ worker: 0 }).length).toBe(1)
  })

  it('updates inFlightCount', () => {
    const id = reserve(0)
    expect(inFlightCount.value).toBe(1)
    releaseReservation(id)
    expect(inFlightCount.value).toBe(0)
  })
})

describe('registerRun with a reservationId', () => {
  it('consumes the reservation so the count stays 1 (not 2) once the real run exists', () => {
    const id = reserve(0)
    expect(inFlight({ worker: 0 }).length).toBe(1)
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 }, id)
    expect(inFlight({ worker: 0 }).length).toBe(1)
    expect(inFlight().length).toBe(1)
  })

  it('the resulting entry is a real run with a tabId', () => {
    const id = reserve(0)
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 }, id)
    const found = inFlight({ tabId: 't1' })
    expect(found.length).toBe(1)
    expect(found[0]?.promptId).toBe('p1')
  })

  it('registerRun without a reservationId leaves reservations untouched', () => {
    reserve(0)
    registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 1 })
    expect(inFlight({ worker: 0 }).length).toBe(1)
    expect(inFlight({ worker: 1 }).length).toBe(1)
    expect(inFlight().length).toBe(2)
  })

  it('registerRun with an unknown reservationId does not throw and still registers', () => {
    expect(() =>
      registerRun({ promptId: 'p1', tabId: 't1', live: true, worker: 0 }, 999999),
    ).not.toThrow()
    expect(inFlight({ worker: 0 }).length).toBe(1)
  })
})

describe('clearAllRuns clears reservations too', () => {
  it('resets reservations along with runs', () => {
    reserve(0)
    reserve(1)
    clearAllRuns()
    expect(inFlight().length).toBe(0)
    expect(inFlightCount.value).toBe(0)
  })
})
