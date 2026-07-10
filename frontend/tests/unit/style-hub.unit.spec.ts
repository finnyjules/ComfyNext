import { describe, it, expect } from 'vitest'
import { hubItems, hubFilters, filterHubItems, hubNodeOptions, type HubItem } from '~/lib/styleHub'

const house: HubItem = {
  id: 'rough-cut-revival', label: 'Rough Cut Revival', tier: 'house',
  useCases: ['illustration', 'poster'], thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp'],
  blurb: 'This aesthetic converges raw linocut.',
  house: {
    id: 'rough-cut-revival', label: 'Rough Cut Revival', useCases: ['illustration', 'poster'],
    trigger: 'rough_cut_revival', tasteProfile: 'This aesthetic converges raw linocut.',
    replicateModel: 'finnyjules/jules-rough_cut_revival',
    weightsUrl: 'https://replicate.delivery/x/y/trained_model.tar',
    thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp'], examplePrompts: ['a lighthouse'],
    suggestedScale: 0.9,
  } as any,
}

describe('styleHub', () => {
  it('hubItems puts house before community and maps community entries', () => {
    const items = hubItems()
    const firstCommunity = items.findIndex(i => i.tier === 'community')
    const lastHouse = items.map(i => i.tier).lastIndexOf('house')
    if (firstCommunity >= 0 && lastHouse >= 0) expect(lastHouse).toBeLessThan(firstCommunity)
    expect(items.some(i => i.tier === 'community')).toBe(true)
    for (const i of items) expect(i.id.length).toBeGreaterThan(0)
  })

  it('filters: community filter and tag filter + search', () => {
    const items = hubItems()
    const community = filterHubItems(items, 'community', '')
    expect(community.every(i => i.tier === 'community')).toBe(true)
    const anime = filterHubItems(items, 'anime', '')
    expect(anime.every(i => i.useCases.includes('anime'))).toBe(true)
    expect(filterHubItems(items, 'all', 'ghibsky').some(i => i.label === 'Ghibsky')).toBe(true)
    const filters = hubFilters(items)
    expect(filters[0]).toEqual({ id: 'all', label: 'All', count: items.length })
    expect(filters.some(f => f.id === 'community')).toBe(true)
    expect(filters.every(f => f.id === 'all' || f.id === 'community' || (f.count ?? 0) > 0)).toBe(true)
  })

  it('hubNodeOptions: house rides lora_url model ref + aesthetic property', () => {
    const opts = hubNodeOptions(house)
    expect(opts.widgetOverrides.lora_url).toBe('finnyjules/jules-rough_cut_revival')
    expect(opts.widgetOverrides.lora_scale).toBe(0.9)
    expect(opts.propertyOverrides!.aesthetic).toBe('This aesthetic converges raw linocut. rough_cut_revival,')
  })

  it('hubNodeOptions: community rides lora_url hfPath + example prompt', () => {
    const item = hubItems().find(i => i.tier === 'community' && i.community?.examplePrompt)!
    const opts = hubNodeOptions(item)
    expect(opts.widgetOverrides.lora_url).toBe(item.community!.hfPath)
    expect(opts.widgetOverrides.prompt).toBe(item.community!.examplePrompt)
    expect(opts.propertyOverrides).toBeUndefined()
  })
})
