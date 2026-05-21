import { atom, computed } from 'nanostores'

export const $currentUser = atom(null)
export const $favoriteIds = atom(new Set())
export const $followingIds = atom(new Set())

export const $isAuthenticated = computed($currentUser, (user) => user !== null)

export function login(user) {
  $currentUser.set(user)
}

export function logout() {
  $currentUser.set(null)
  $favoriteIds.set(new Set())
  $followingIds.set(new Set())
}

export function toggleFavorite(workflowId) {
  const current = new Set($favoriteIds.get())
  if (current.has(workflowId)) {
    current.delete(workflowId)
  } else {
    current.add(workflowId)
  }
  $favoriteIds.set(current)
}

export function toggleFollow(creatorId) {
  const current = new Set($followingIds.get())
  if (current.has(creatorId)) {
    current.delete(creatorId)
  } else {
    current.add(creatorId)
  }
  $followingIds.set(current)
}
