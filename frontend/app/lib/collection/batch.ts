import type { CollectionRow } from './types'

export type BatchStatus = 'queued' | 'rendering' | 'done' | 'failed'

export interface BatchItem {
  id: string
  rowIndex: number
  rowId: string
  outputId: string
  status: BatchStatus
  url?: string
  assetName?: string
  error?: string
}

export function planBatch(rows: CollectionRow[], outputs: { id: string }[]): BatchItem[] {
  const items: BatchItem[] = []
  rows.forEach((row, rowIndex) => {
    for (const o of outputs) {
      items.push({
        id: `${row.id}:${o.id}`,
        rowIndex, rowId: row.id, outputId: o.id, status: 'queued',
      })
    }
  })
  return items
}

export async function runBatch(
  items: BatchItem[],
  renderItem: (item: BatchItem) => Promise<void>,
  opts?: {
    concurrency?: number
    signal?: { cancelled: boolean }
    onUpdate?: (item: BatchItem) => void
  },
): Promise<void> {
  const concurrency = Math.max(1, opts?.concurrency ?? 3)
  const queue = [...items]
  async function worker(): Promise<void> {
    while (queue.length) {
      if (opts?.signal?.cancelled) return
      const item = queue.shift()
      if (!item || item.status !== 'queued') continue
      item.status = 'rendering'
      opts?.onUpdate?.(item)
      try {
        await renderItem(item)
        item.status = 'done'
      } catch (e) {
        item.status = 'failed'
        item.error = e instanceof Error ? e.message : String(e)
      }
      opts?.onUpdate?.(item)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}
