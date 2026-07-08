import { describe, expect, it } from 'vitest'
import { shouldCloseWorkerSocket, shouldGiveUpWorker } from '~/composables/useDirectExecution'

describe('shouldCloseWorkerSocket', () => {
  it('closes when there are no mappings and no pending POSTs', () => {
    expect(shouldCloseWorkerSocket(1, [], 0)).toBe(true)
  })

  it('does not close when no mappings but a POST is still pending', () => {
    expect(shouldCloseWorkerSocket(1, [], 1)).toBe(false)
  })

  it('does not close when a sibling mapping is present for the worker', () => {
    expect(shouldCloseWorkerSocket(1, [1, 1], 0)).toBe(false)
  })

  it('never closes worker 0 (main), regardless of mappings/pending', () => {
    expect(shouldCloseWorkerSocket(0, [], 0)).toBe(false)
    expect(shouldCloseWorkerSocket(0, [0], 5)).toBe(false)
  })
})

describe('shouldGiveUpWorker', () => {
  it('never gives up on worker 0 (main) — it must retry forever', () => {
    expect(shouldGiveUpWorker(0, 0)).toBe(false)
    expect(shouldGiveUpWorker(0, 4)).toBe(false)
    expect(shouldGiveUpWorker(0, 100)).toBe(false)
  })

  it('gives up a pool worker (>=1) once it hits 4 consecutive failures', () => {
    expect(shouldGiveUpWorker(1, 4)).toBe(true)
    expect(shouldGiveUpWorker(2, 5)).toBe(true)
  })

  it('does not give up a pool worker below 4 consecutive failures', () => {
    expect(shouldGiveUpWorker(1, 0)).toBe(false)
    expect(shouldGiveUpWorker(1, 3)).toBe(false)
  })
})
