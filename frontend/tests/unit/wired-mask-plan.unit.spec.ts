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
