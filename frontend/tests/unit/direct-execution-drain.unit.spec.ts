import { describe, expect, it } from 'vitest'
import { shouldCloseWorkerSocket } from '~/composables/useDirectExecution'

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
