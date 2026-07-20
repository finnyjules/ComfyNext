import { describe, it, expect } from 'vitest'
import { planZip, planSetZip, sanitize, viewUrl } from '~/lib/deliverables/zip'
import type { DeliverableItem, ArtifactRef } from '~/lib/deliverables/model'

const ref = (f: string): ArtifactRef => ({ filename: f, subfolder: 'out', media: 'image' })

describe('deliverables zip planner', () => {
  it('viewUrl targets the output type', () => {
    expect(viewUrl(ref('a.png'))).toBe('/view?filename=a.png&subfolder=out&type=output')
  })

  it('planZip roots singles and subfolders set members in order', () => {
    const list: DeliverableItem[] = [
      { id: '1', kind: 'single', name: 'Hero', ref: ref('hero.png') },
      { id: '2', kind: 'set', name: 'Launch Post', items: [ref('sq.png'), ref('wd.png')] },
    ]
    expect(planZip(list)).toEqual([
      { path: 'hero.png', ref: ref('hero.png') },
      { path: 'Launch Post/sq.png', ref: ref('sq.png') },
      { path: 'Launch Post/wd.png', ref: ref('wd.png') },
    ])
  })

  it('planZip disambiguates duplicate paths', () => {
    const list: DeliverableItem[] = [
      { id: '1', kind: 'single', name: 'A', ref: ref('img.png') },
      { id: '2', kind: 'single', name: 'B', ref: { ...ref('img.png'), subfolder: 'other' } },
    ]
    expect(planZip(list).map(e => e.path)).toEqual(['img.png', 'img (2).png'])
  })

  it('planSetZip is flat and ordered', () => {
    const set = { id: 's', kind: 'set', name: 'S', items: [ref('a.png'), ref('b.png')] } as const
    expect(planSetZip(set).map(e => e.path)).toEqual(['a.png', 'b.png'])
  })

  it('sanitize strips path separators', () => {
    expect(sanitize('a/b:c')).toBe('a-b-c')
  })
})
