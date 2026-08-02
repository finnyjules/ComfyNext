import { describe, it, expect } from 'vitest'
import { initialLoraGalleryTab, loraGallerySource, isCharacterItem } from '~/lib/graph/loraGalleryTabs'

/**
 * LoraGalleryModal used to hard-filter the fetched LoRA list by the slot's
 * `kind` prop (characters only in slot A, styles everywhere else), so a
 * style-only user could never fill slot A. The gallery now shows all three
 * libraries from every slot via a switchable tab strip; these tests cover the
 * pure logic that used to be inline in the component — seeding, source
 * selection, and (critically) trigger-routing keyed off the PICKED ITEM
 * rather than the slot.
 */
describe('initialLoraGalleryTab', () => {
  it('seeds Characters for a character slot', () => {
    expect(initialLoraGalleryTab('character')).toBe('characters')
  })

  it('seeds Your Styles for a style slot', () => {
    expect(initialLoraGalleryTab('style')).toBe('yours')
  })

  it('seeds Your Styles when kind is unset', () => {
    expect(initialLoraGalleryTab(undefined)).toBe('yours')
  })
})

describe('loraGallerySource', () => {
  const characters = ['char1', 'char2']
  const styles = ['style1']
  const house = ['house1', 'house2', 'house3']

  it('returns characters for the characters tab', () => {
    expect(loraGallerySource(characters, styles, house, 'characters')).toBe(characters)
  })

  it('returns styles for the yours tab', () => {
    expect(loraGallerySource(characters, styles, house, 'yours')).toBe(styles)
  })

  it('returns house items for the house tab', () => {
    expect(loraGallerySource(characters, styles, house, 'house')).toBe(house)
  })
})

describe('isCharacterItem', () => {
  it('treats a character-kind item as a character', () => {
    expect(isCharacterItem({ kind: 'character' })).toBe(true)
  })

  it('treats a style-kind item as a style', () => {
    expect(isCharacterItem({ kind: 'style' })).toBe(false)
  })

  it('treats an item with no kind as a style', () => {
    expect(isCharacterItem({})).toBe(false)
  })

  it('treats a house-style item as a style even if kind looks like character', () => {
    expect(isCharacterItem({ kind: 'character', houseStyle: { id: 'x' } })).toBe(false)
  })
})
