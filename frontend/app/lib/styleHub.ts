import { HOUSE_STYLES, USE_CASE_TAGS, houseStyleStyleBlock, type HouseStyle } from '~/data/house-styles'
import { LORA_LIBRARY, type LoRALibraryEntry } from '~/data/lora-library'

export interface HubItem {
  id: string
  label: string
  tier: 'house' | 'community'
  useCases: string[]
  thumbnails: string[]
  blurb: string
  house?: HouseStyle
  community?: LoRALibraryEntry
}

export function hubItems(): HubItem[] {
  const house: HubItem[] = [...HOUSE_STYLES]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(s => ({
      id: `house:${s.id}`, label: s.label, tier: 'house',
      useCases: s.useCases, thumbnails: s.thumbnails,
      blurb: s.tasteProfile, house: s,
    }))
  const community: HubItem[] = LORA_LIBRARY.map(e => ({
    id: `community:${e.hfPath}`, label: e.label, tier: 'community',
    useCases: e.useCases ?? [], thumbnails: [],
    blurb: e.blurb, community: e,
  }))
  return [...house, ...community]
}

export function hubFilters(items: HubItem[]) {
  const tagFilters = USE_CASE_TAGS
    .map(tag => ({ id: tag as string, label: tag.charAt(0).toUpperCase() + tag.slice(1), count: items.filter(i => i.useCases.includes(tag)).length }))
    .filter(f => f.count > 0)
  return [
    { id: 'all', label: 'All', count: items.length },
    ...tagFilters,
    { id: 'community', label: 'Community', count: items.filter(i => i.tier === 'community').length },
  ]
}

export function filterHubItems(items: HubItem[], filterId: string, query: string): HubItem[] {
  let out = items
  if (filterId === 'community') out = out.filter(i => i.tier === 'community')
  else if (filterId !== 'all') out = out.filter(i => i.useCases.includes(filterId))
  const q = query.trim().toLowerCase()
  if (q) out = out.filter(i => i.label.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q))
  return out
}

/** addNode options for "Use style" — both tiers ride FluxLoRARemoteNode.lora_url. */
export function hubNodeOptions(item: HubItem): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides?: Record<string, unknown>
} {
  if (item.tier === 'house' && item.house) {
    const s = item.house
    return {
      widgetOverrides: {
        lora_url: s.replicateModel, // bare owner/model — backend _is_replicate_model_ref runs it directly
        ...(s.suggestedScale != null ? { lora_scale: s.suggestedScale } : {}),
      },
      propertyOverrides: { aesthetic: houseStyleStyleBlock(s) },
    }
  }
  const e = item.community!
  return {
    widgetOverrides: {
      lora_url: e.hfPath,
      ...(e.examplePrompt ? { prompt: e.examplePrompt } : {}),
      ...(e.suggestedScale != null ? { lora_scale: e.suggestedScale } : {}),
    },
  }
}
