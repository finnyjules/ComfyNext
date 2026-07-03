import { describe, it, expect } from 'vitest'
import { planBatch, runBatch, type BatchItem } from '~/lib/collection/batch'

const rows = [
  { id: 'r1', values: {} }, { id: 'r2', values: {} }, { id: 'r3', values: {} },
]

describe('planBatch', () => {
  it('crosses rows with outputs, row-major', () => {
    const items = planBatch(rows, [{ id: '1x1' }, { id: '9x16' }])
    expect(items).toHaveLength(6)
    expect(items[0]).toMatchObject({ rowIndex: 0, outputId: '1x1', status: 'queued' })
    expect(items[1]).toMatchObject({ rowIndex: 0, outputId: '9x16' })
    expect(items[2]).toMatchObject({ rowIndex: 1, outputId: '1x1' })
  })
})

describe('runBatch', () => {
  it('runs all items and reports updates', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    const seen: string[] = []
    await runBatch(items, async (it) => { it.url = `u${it.rowIndex}` }, {
      onUpdate: it => seen.push(`${it.rowId}:${it.status}`),
    })
    expect(items.every(i => i.status === 'done')).toBe(true)
    expect(seen).toContain('r1:rendering')
    expect(seen).toContain('r1:done')
  })
  it('isolates failures — one throw never aborts the rest', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    await runBatch(items, async (it) => {
      if (it.rowId === 'r2') throw new Error('boom')
    })
    expect(items.map(i => i.status)).toEqual(['done', 'failed', 'done'])
    expect(items[1].error).toBe('boom')
  })
  it('cancellation leaves remaining items queued', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    const signal = { cancelled: false }
    await runBatch(items, async (it) => {
      if (it.rowId === 'r1') signal.cancelled = true
    }, { concurrency: 1, signal })
    expect(items[0].status).toBe('done')
    expect(items[1].status).toBe('queued')
    expect(items[2].status).toBe('queued')
  })
  it('respects the concurrency cap', async () => {
    const items = planBatch(rows, [{ id: 'o' }])
    let live = 0, peak = 0
    await runBatch(items, async () => {
      live++; peak = Math.max(peak, live)
      await new Promise(r => setTimeout(r, 5))
      live--
    }, { concurrency: 2 })
    expect(peak).toBeLessThanOrEqual(2)
  })
})
