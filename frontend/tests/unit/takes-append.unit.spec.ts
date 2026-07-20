import { describe, expect, it } from 'vitest'
import { appendTake, refreshTakeDisplay } from '~/composables/useTakes'

// A take as built from an `executed` event. `sig` is the output's filename
// signature; live-preview generators reuse a FIXED filename, so re-rolls share a
// sig. `promptId` is the run id — unique per queued run (re-roll), shared by a
// single run's (possibly streamed) re-emissions.
const mk = (id: string, promptId: string | null, sig: string) =>
  ({ id, createdAt: 0, promptId, sig, images: [`/view?f=${id}`] })

describe('appendTake — re-roll accumulation', () => {
  it('appends re-rolls that share a fixed output filename but are different runs', () => {
    let data: any = {}
    data = appendTake(data, mk('a', 'run-1', 'preview.png'))
    data = appendTake(data, mk('b', 'run-2', 'preview.png')) // re-roll: same live-preview filename, new run
    data = appendTake(data, mk('c', 'run-3', 'preview.png'))
    expect(data.takes.map((t: any) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('refreshes in place when the SAME run re-emits (same promptId)', () => {
    let data: any = {}
    data = appendTake(data, mk('a', 'run-1', 'preview.png'))
    data = appendTake(data, mk('a2', 'run-1', 'preview.png')) // same run streams a newer preview
    expect(data.takes).toHaveLength(1)
    expect(data.takes[0].id).toBe('a2')
  })

  it('falls back to signature dedup when there is no promptId', () => {
    let data: any = {}
    data = appendTake(data, mk('a', null, 'preview.png'))
    data = appendTake(data, mk('b', null, 'preview.png'))
    expect(data.takes).toHaveLength(1)
  })
})

describe('refreshTakeDisplay — scrub-preview emissions (no take capture)', () => {
  // Live-preview nodes (Blur, AdjustCurves, …) re-run on every widget tweak
  // and write ONE fixed-name temp file per node. Capturing those emissions as
  // takes built a filmstrip of aliases to a single mutable file — picking an
  // older take showed stale browser-cached pixels while downstream runs read
  // the newest content. For these nodes the display refreshes; no take.
  it('mirrors the emission onto the display fields', () => {
    const next = refreshTakeDisplay({ images: ['/view?f=old'] } as any, mk('a', 'run-1', 'p.png') as any)
    expect(next.images).toEqual(['/view?f=a'])
  })

  it('leaves takes and the active pick untouched', () => {
    const prior = { takes: [mk('kept', 'run-0', 'p.png')], activeTakeId: 'kept', images: ['/view?f=kept'] }
    const next = refreshTakeDisplay(prior as any, mk('b', 'run-2', 'p.png') as any)
    expect(next.takes).toHaveLength(1)
    expect(next.takes![0]!.id).toBe('kept')
    expect(next.activeTakeId).toBe('kept')
    expect(next.images).toEqual(['/view?f=b'])
  })

  it('is pure: the input object is not mutated', () => {
    const prior: any = { images: ['/view?f=old'], takes: [] }
    refreshTakeDisplay(prior, mk('c', 'run-3', 'p.png') as any)
    expect(prior.images).toEqual(['/view?f=old'])
  })
})
