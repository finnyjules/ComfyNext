import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useDeliverables } from '~/composables/useDeliverables'
import type { ProjectDoc } from '~/lib/projectDoc'
import type { ArtifactRef } from '~/lib/deliverables/model'

const artifact = (f: string): ArtifactRef => ({ filename: f, subfolder: 'out', media: 'image' })
function doc(): ProjectDoc { return { canvases: [], activeCanvasId: '' } as ProjectDoc }

describe('useDeliverables', () => {
  it('markReady appends and persists, and is a no-op the second time', () => {
    const d = ref<ProjectDoc | null>(doc())
    const persist = vi.fn()
    const dl = useDeliverables(d, persist)
    expect(dl.markReady(artifact('hero.png'), 'Hero')).toBe(true)
    expect(dl.count.value).toBe(1)
    expect(persist).toHaveBeenCalledTimes(1)
    expect(dl.markReady(artifact('hero.png'))).toBe(false)
    expect(dl.count.value).toBe(1)
    expect(persist).toHaveBeenCalledTimes(1) // no-op did not persist
  })

  it('isReady reflects state', () => {
    const d = ref<ProjectDoc | null>(doc())
    const dl = useDeliverables(d, vi.fn())
    dl.markReady(artifact('a.png'))
    expect(dl.isReady(artifact('a.png'))).toBe(true)
    expect(dl.isReady(artifact('b.png'))).toBe(false)
  })

  it('group + ungroup round-trips through the doc', () => {
    const d = ref<ProjectDoc | null>(doc())
    const dl = useDeliverables(d, vi.fn())
    dl.markReady(artifact('a.png'), 'A')
    dl.markReady(artifact('b.png'), 'B')
    const ids = dl.items.value.map(i => i.id)
    dl.groupItems(ids, 'Pair')
    expect(dl.items.value).toHaveLength(1)
    expect(dl.items.value[0]!.kind).toBe('set')
    dl.ungroupItem(dl.items.value[0]!.id)
    expect(dl.items.value).toHaveLength(2)
  })

  it('tolerates a null doc', () => {
    const d = ref<ProjectDoc | null>(null)
    const dl = useDeliverables(d, vi.fn())
    expect(dl.markReady(artifact('a.png'))).toBe(false)
    expect(dl.count.value).toBe(0)
  })

  it('no-op mutators do not persist', () => {
    const d = ref<ProjectDoc | null>(doc())
    const persist = vi.fn()
    const dl = useDeliverables(d, persist)
    dl.markReady(artifact('a.png'), 'A')
    dl.markReady(artifact('b.png'), 'B')
    expect(persist).toHaveBeenCalledTimes(2)

    dl.moveItem(0, 0)
    expect(persist).toHaveBeenCalledTimes(2)

    dl.removeItem('does-not-exist')
    expect(persist).toHaveBeenCalledTimes(2)

    expect(dl.count.value).toBe(2)
  })
})
