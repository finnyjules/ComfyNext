/**
 * Stage 5 Task 5: tenant ownership gating for the shared ComfyUI engine's
 * read/control endpoints. These are the pure-filter tests — the h3 handlers
 * (handleHostedQueueGet, handleHostedInterrupt, harvestPendingOutputs) are
 * thin wrappers exercised by live verification, not unit-tested here.
 */
import { describe, it, expect } from 'vitest'
import { filterQueuePayload, filterHistoryPayload } from '../../server/utils/engineGate'

// ComfyUI queue entries are tuples: [number, prompt_id, prompt, extra_data, outputs_to_execute]
const q = (id: string) => [1, id, {}, {}, []]

describe('filterQueuePayload', () => {
  it('keeps only owned entries in running and pending', () => {
    const out = filterQueuePayload(
      { queue_running: [q('mine')], queue_pending: [q('mine2'), q('theirs')] },
      new Set(['mine', 'mine2']))
    expect(out.queue_running.map((e: any) => e[1])).toEqual(['mine'])
    expect(out.queue_pending.map((e: any) => e[1])).toEqual(['mine2'])
  })
  it('tolerates missing arrays', () => {
    expect(filterQueuePayload({}, new Set())).toEqual({ queue_running: [], queue_pending: [] })
  })
})

describe('filterHistoryPayload', () => {
  it('drops entries the user does not own', () => {
    const out = filterHistoryPayload({ a: { x: 1 }, b: { x: 2 } }, new Set(['b']))
    expect(Object.keys(out)).toEqual(['b'])
  })
})
