/**
 * Composable for Sailor-specific settings stored in localStorage.
 * These are separate from ComfyUI's settings API.
 */
export function useLocalSettings() {
  function getLocalSetting(key: string): string | null {
    if (import.meta.server) return null
    return localStorage.getItem(`sailor:${key}`)
  }

  function setLocalSetting(key: string, value: string): void {
    if (import.meta.server) return
    localStorage.setItem(`sailor:${key}`, value)
    // Dispatch custom event for same-tab listeners (storage event only fires cross-tab)
    window.dispatchEvent(new CustomEvent('sailor:setting-changed', { detail: { key: `sailor:${key}`, value } }))
  }

  return {
    getLocalSetting,
    setLocalSetting,
  }
}
