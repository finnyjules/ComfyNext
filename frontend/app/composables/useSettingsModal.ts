const settingsOpen = ref(false)

export function useSettingsModal() {
  function openSettings() {
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  return {
    settingsOpen,
    openSettings,
    closeSettings,
  }
}
