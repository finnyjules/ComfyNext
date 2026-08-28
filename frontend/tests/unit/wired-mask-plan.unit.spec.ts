import { describe, it, expect } from 'vitest'
import { planWiredMaskJobs } from '~/composables/wiredMaskPlan'
import { setWiredMaskUrl, readWiredTreatments } from '~/composables/useWiredTreatments'

describe('planWiredMaskJobs', () => {
  it('yields a job for a masked, connected slot', () => {
    const jobs = planWiredMaskJobs({ 'w:1': { maskedByKey: 'w:2' } }, [1, 2])
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'w:2', showSource: false }])
  })

  it('yields no job when the slot has no treatment', () => {
    expect(planWiredMaskJobs({}, [1, 2])).toEqual([])
  })

  it('yields no job when the treatment has no maskedByKey', () => {
    expect(planWiredMaskJobs({ 'w:1': { showSource: true } }, [1, 2])).toEqual([])
  })

  it('skips a job whose wired mask source is missing / disconnected', () => {
    // w:3 is not in the connected set, so the mask against it is unsatisfiable.
    expect(planWiredMaskJobs({ 'w:1': { maskedByKey: 'w:3' } }, [1, 2])).toEqual([])
  })

  it('keeps a job whose source is local (l:..) regardless of connected slots', () => {
    const jobs = planWiredMaskJobs({ 'w:1': { maskedByKey: 'l:abc' } }, [1])
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'l:abc', showSource: false }])
  })

  it('flows showSource through', () => {
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2', showSource: true } },
      [1, 2],
    )
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'w:2', showSource: true }])
  })

  it('skips a self-referential mask (a layer cannot mask itself)', () => {
    expect(planWiredMaskJobs({ 'w:1': { maskedByKey: 'w:1' } }, [1, 2])).toEqual([])
  })

  it('only emits jobs for slots that are themselves connected', () => {
    // w:5 is masked but not connected → no job; w:1 masked + connected → job.
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2' }, 'w:5': { maskedByKey: 'w:2' } },
      [1, 2],
    )
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'w:2', showSource: false }])
  })
})

// Schema 2: a connected slot IS a layer, and the modal writes that layer's mask
// onto the LAYER (`setLocal(id, { maskedByKey })`), leaving the frozen
// `sailor_wiredTreatments` registry exactly as migration found it. Reading only
// the registry here made the server render the PRE-MIGRATION mask: setting or
// clearing a wired layer's mask in the editor changed nothing at Generate.
// Same registry-then-layer-overlay shape as the cloner fix (d49fc31f1).
describe('planWiredMaskJobs — migrated wired layers override the registry', () => {
  const wired = (slot: number, patch: Record<string, any> = {}) =>
    ({ id: `wl-${slot}`, kind: 'wired', slot, ...patch })

  it("uses the LAYER's mask over the frozen registry entry", () => {
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2' } },                       // pre-migration
      [1, 2],
      [wired(0, { maskedByKey: 'l:local-a' }), wired(1)],      // edited after
    )
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'l:local-a', showSource: false }])
  })

  it('CLEARING the mask on the layer clears the job (registry is not a fallback)', () => {
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2' } },
      [1, 2],
      [wired(0), wired(1)],
    )
    expect(jobs).toEqual([])
  })

  it("carries the layer's own showSource, not the registry's", () => {
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2', showSource: true } },
      [1, 2],
      [wired(0, { maskedByKey: 'l:local-a' }), wired(1)],
    )
    expect(jobs[0]!.showSource).toBe(false)
    const kept = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2' } },
      [1, 2],
      [wired(0, { maskedByKey: 'l:local-a', maskShowSource: true }), wired(1)],
    )
    expect(kept[0]!.showSource).toBe(true)
  })

  it('honours the legacy maskedById form on a layer', () => {
    const jobs = planWiredMaskJobs({}, [1], [wired(0, { maskedById: 'local-a' })])
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'l:local-a', showSource: false }])
  })

  it('leaves an UNMIGRATED slot reading the registry', () => {
    // Slot 2 has no layer claiming it (legacy frame / edge just landed).
    const jobs = planWiredMaskJobs(
      { 'w:2': { maskedByKey: 'w:1' } },
      [1, 2],
      [wired(0, { maskedByKey: 'l:local-a' })],
    )
    expect(jobs).toEqual([
      { contentSlot: 1, sourceKey: 'l:local-a', showSource: false },
      { contentSlot: 2, sourceKey: 'w:1', showSource: false },
    ])
  })

  it('ignores non-wired layers (a local layer never claims a slot)', () => {
    const jobs = planWiredMaskJobs(
      { 'w:1': { maskedByKey: 'w:2' } },
      [1, 2],
      [{ id: 'a', kind: 'rect', maskedByKey: 'l:zzz' } as any],
    )
    expect(jobs).toEqual([{ contentSlot: 1, sourceKey: 'w:2', showSource: false }])
  })

  it('skips a self-mask expressed as the layer\'s OWN key', () => {
    const jobs = planWiredMaskJobs({}, [1], [wired(0, { maskedByKey: 'l:wl-0' })])
    expect(jobs).toEqual([])
  })

  it('skips a mask whose wired-LAYER source is disconnected or unlinked', () => {
    // The source layer holds slot 1 (1-based 2), which has no edge: no pixels to
    // mask against, so the silhouette would come out blank and erase the content.
    const gone = planWiredMaskJobs(
      {}, [1],
      [wired(0, { maskedByKey: 'l:wl-1' }), wired(1, { unlinked: true })],
    )
    expect(gone).toEqual([])
    const live = planWiredMaskJobs(
      {}, [1, 2],
      [wired(0, { maskedByKey: 'l:wl-1' }), wired(1)],
    )
    expect(live).toEqual([{ contentSlot: 1, sourceKey: 'l:wl-1', showSource: false }])
  })
})

describe('setWiredMaskUrl', () => {
  const mkNode = () => ({ data: { properties: {} as any } })
  it('sets a maskUrl on the slot key', () => {
    const n = mkNode()
    setWiredMaskUrl(n, 2, 'data:img/png;base64,AAAA')
    expect(readWiredTreatments(n)['w:2']).toEqual({ maskUrl: 'data:img/png;base64,AAAA' })
  })
  it('preserves an existing maskedByKey on the same slot', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskedByKey: 'l:x', showSource: true } }
    setWiredMaskUrl(n, 1, 'data:MASK')
    expect(readWiredTreatments(n)['w:1']).toEqual({ maskedByKey: 'l:x', showSource: true, maskUrl: 'data:MASK' })
  })
  it('clears maskUrl and drops the entry when empty', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskUrl: 'data:MASK' } }
    setWiredMaskUrl(n, 1, '')
    expect(readWiredTreatments(n)['w:1']).toBeUndefined()
  })
  it('clears maskUrl but keeps the entry when other fields remain', () => {
    const n = mkNode()
    n.data.properties.sailor_wiredTreatments = { 'w:1': { maskUrl: 'data:MASK', maskedByKey: 'l:x' } }
    setWiredMaskUrl(n, 1, '')
    expect(readWiredTreatments(n)['w:1']).toEqual({ maskedByKey: 'l:x' })
  })
})
