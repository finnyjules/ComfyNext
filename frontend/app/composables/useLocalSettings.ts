/**
 * Composable for ComfyNext-specific settings stored in localStorage.
 * These are separate from ComfyUI's settings API.
 */
export function useLocalSettings() {
  function getLocalSetting(key: string): string | null {
    if (import.meta.server) return null
    return localStorage.getItem(`comfynext:${key}`)
  }

  function setLocalSetting(key: string, value: string): void {
    if (import.meta.server) return
    localStorage.setItem(`comfynext:${key}`, value)
    // Dispatch custom event for same-tab listeners (storage event only fires cross-tab)
    window.dispatchEvent(new CustomEvent('comfynext:setting-changed', { detail: { key: `comfynext:${key}`, value } }))
  }

  return {
    getLocalSetting,
    setLocalSetting,
  }
}
