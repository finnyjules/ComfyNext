import { atom } from 'nanostores'

export const $searchQuery = atom('')
export const $searchFilters = atom({
  category: [],
  model: [],
  difficulty: null,
  outputType: [],
  technique: [],
})
export const $searchResults = atom([])
export const $searchTotal = atom(0)
export const $searchPage = atom(1)
export const $searchViewMode = atom('grid')
export const $searchSort = atom('relevance')
export const $searchLoading = atom(false)

export function resetSearch() {
  $searchQuery.set('')
  $searchFilters.set({
    category: [],
    model: [],
    difficulty: null,
    outputType: [],
    technique: [],
  })
  $searchResults.set([])
  $searchTotal.set(0)
  $searchPage.set(1)
  $searchSort.set('relevance')
  $searchLoading.set(false)
}
