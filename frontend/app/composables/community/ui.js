import { atom } from 'nanostores'

export const $mobileMenuOpen = atom(false)
export const $toasts = atom([])
export const $searchModalOpen = atom(false)

let toastId = 0

export function addToast(message, type = 'info', duration = 3000) {
  const id = ++toastId
  const toast = { id, message, type }
  $toasts.set([...$toasts.get(), toast])

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration)
  }

  return id
}

export function dismissToast(id) {
  $toasts.set($toasts.get().filter((t) => t.id !== id))
}
