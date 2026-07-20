import { describe, it, expect } from 'vitest'
import { stashTakesIntoProperties, restoreTakesFromProperties } from '../../app/lib/canvas/persistTakes'

const take = (id: string, img: string) => ({ id, images: [img], createdAt: 1 })

describe('stashTakesIntoProperties', () => {
  it('stashes takes + activeTakeId under sailor_takes', () => {
    const data = { takes: [take('t1', 'a.png'), take('t2', 'b.png')], activeTakeId: 't1' }
    const props = stashTakesIntoProperties(data, { existing: 1 })
    expect(props.existing).toBe(1)
    expect(props.sailor_takes.takes).toHaveLength(2)
    expect(props.sailor_takes.activeTakeId).toBe('t1')
  })

  it('leaves properties untouched when there are no takes', () => {
    const props = { existing: 1 }
    expect(stashTakesIntoProperties({}, props)).toBe(props)
    expect(stashTakesIntoProperties({ takes: [] }, props)).toBe(props)
  })

  it('removes a stale sailor_takes stash when takes were discarded', () => {
    const props = { existing: 1, sailor_takes: { takes: [take('old', 'x.png')], activeTakeId: 'old' } }
    const out = stashTakesIntoProperties({ takes: [] }, props)
    expect(out.sailor_takes).toBeUndefined()
    expect(out.existing).toBe(1)
  })

  it('handles undefined properties', () => {
    const out = stashTakesIntoProperties({ takes: [take('t1', 'a.png')], activeTakeId: 't1' }, undefined)
    expect(out.sailor_takes.takes).toHaveLength(1)
  })
})

describe('restoreTakesFromProperties', () => {
  it('round-trips: restores what stash wrote', () => {
    const data = { takes: [take('t1', 'a.png'), take('t2', 'b.png')], activeTakeId: 't2' }
    const restored = restoreTakesFromProperties(stashTakesIntoProperties(data, {}))
    expect(restored).toEqual({ takes: data.takes, activeTakeId: 't2' })
  })

  it('falls back to the last take when activeTakeId is stale', () => {
    const props = { sailor_takes: { takes: [take('t1', 'a.png'), take('t2', 'b.png')], activeTakeId: 'gone' } }
    expect(restoreTakesFromProperties(props)!.activeTakeId).toBe('t2')
  })

  it('returns null for absent or malformed stashes', () => {
    expect(restoreTakesFromProperties(undefined)).toBeNull()
    expect(restoreTakesFromProperties({})).toBeNull()
    expect(restoreTakesFromProperties({ sailor_takes: 'junk' })).toBeNull()
    expect(restoreTakesFromProperties({ sailor_takes: { takes: [] } })).toBeNull()
    expect(restoreTakesFromProperties({ sailor_takes: { takes: [{ noId: true }] } })).toBeNull()
  })
})
