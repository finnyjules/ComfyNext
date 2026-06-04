/**
 * useVersions — named project snapshots on top of durable Projects.
 *
 * The durable Project keeps a rolling "current" version (the live autosave; see
 * default.vue saveDurableVersion). This composable adds *named, immutable*
 * snapshots: list them (excluding the rolling current), save the current canvas
 * as a new one, and fetch one back to restore. Thin wrapper over useProjects;
 * the actual canvas restore is done by the caller (which owns the canvas).
 *
 * See docs/plans/2026-06-02-creative-studio-project-takes-design.md (Phase 2).
 */
import type { VersionMeta } from '~/composables/useProjects'

const ROLLING_ID = 'current'

let _seq = 0
function makeVersionId(): string {
  _seq += 1
  return `v_${Date.now().toString(36)}_${_seq}`
}

export function useVersions() {
  const { loadProject, saveVersion, loadVersion } = useProjects()
  const versions = ref<VersionMeta[]>([])
  const loading = ref(false)

  async function refresh(projectId: string | null) {
    if (!projectId) { versions.value = []; return }
    loading.value = true
    try {
      const res = await loadProject(projectId)
      const idx = res?.project?.versionIndex ?? []
      versions.value = idx
        .filter((v) => v.id !== ROLLING_ID) // hide the rolling autosave
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    } finally {
      loading.value = false
    }
  }

  /** Snapshot a workflow as a new named version, then refresh the list. */
  async function saveNamed(
    projectId: string,
    name: string,
    workflow: any,
    projectName?: string,
  ): Promise<boolean> {
    if (!projectId || !workflow) return false
    const id = await saveVersion(
      projectId,
      { id: makeVersionId(), name: name || 'Untitled version', workflow },
      projectName,
    )
    if (id) await refresh(projectId)
    return !!id
  }

  /** Fetch a version's workflow body (for the caller to load onto the canvas). */
  async function getVersionWorkflow(projectId: string, vid: string): Promise<any | null> {
    const v = await loadVersion(projectId, vid)
    return v?.workflow ?? null
  }

  return { versions, loading, refresh, saveNamed, getVersionWorkflow }
}
