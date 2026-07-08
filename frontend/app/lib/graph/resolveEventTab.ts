import { getRun } from './runRegistry'

// Attribute a bridge/direct execution event to the tab that owns it.
//
// Direct-mode runs are tracked in the run registry keyed by prompt_id, so an
// event carrying a known prompt_id belongs to that run's originating tab —
// even if it isn't the active one (background canvas, other worker). When the
// prompt_id is absent or not in the registry (bridge-path runs, synthesized
// events with no id), we preserve today's behavior: fall back to the active
// project tab that the caller resolved.
//
// Pure: reads the module-singleton registry, no side effects.
export function resolveEventTab(
  promptId: string | null | undefined,
  activeProjectTabId: string | null,
): string | null {
  if (promptId) {
    const entry = getRun(promptId)
    if (entry) return entry.tabId
  }
  return activeProjectTabId
}
