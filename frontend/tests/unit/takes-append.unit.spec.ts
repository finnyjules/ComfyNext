import { describe, expect, it } from 'vitest'
import { appendTake } from '~/composables/useTakes'

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
