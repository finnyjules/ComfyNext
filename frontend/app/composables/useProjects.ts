/**
 * useProjects — client API for durable server-side Projects (Phase 0).
 *
 * Thin typed wrapper over the /comfynext/projects endpoints implemented in
 * comfy_extras/nodes_comfynext_projects.py (proxied to ComfyUI like the rest of
 * /comfynext/*). Every call degrades gracefully — a missing endpoint (older
 * ComfyUI without the module) or a network error resolves to an empty/falsy
 * result rather than throwing, so callers can treat durable projects as an
 * enrichment layer over the existing /history flow.
 *
 * See docs/plans/2026-06-02-phase0-project-persistence-spec.md.
 */

export interface ProjectMeta {
  uuid: string
  name: string | null
  cover: string | null
  updatedAt: number | null
}

export interface ProjectVersion {
  id: string
  name: string
  createdAt: number
  parentId: string | null
  workflow?: any
  activeTakes?: Record<string, string>
  cover?: string | null
}

export interface VersionMeta {
  id: string
  name: string | null
  createdAt: number | null
  parentId: string | null
}

export interface Project {
  uuid: string
  name: string
  cover: string | null
  createdAt: number
  updatedAt: number
  currentVersionId: string | null
  versionIndex: VersionMeta[]
}

export function useProjects() {
  async function listProjects(): Promise<ProjectMeta[]> {
    try {
      const res = await $fetch<{ projects: ProjectMeta[] }>('/comfynext/projects')
      return res.projects ?? []
    } catch (e) {
      console.warn('[useProjects] list failed:', e)
      return []
    }
  }

  async function loadProject(
    uuid: string,
  ): Promise<{ project: Project; currentVersion: ProjectVersion | null } | null> {
    try {
      return await $fetch(`/comfynext/projects/${encodeURIComponent(uuid)}`)
    } catch (e) {
      console.warn('[useProjects] load failed:', e)
      return null
    }
  }

  /** Snapshot the whole project as a new version; auto-creates the project. */
  async function saveVersion(
    uuid: string,
    version: Partial<ProjectVersion>,
    projectName?: string,
  ): Promise<string | null> {
    try {
      const res = await $fetch<{ id: string }>(
        `/comfynext/projects/${encodeURIComponent(uuid)}/versions`,
        { method: 'POST', body: { projectName, version } },
      )
      return res.id ?? null
    } catch (e) {
      console.warn('[useProjects] saveVersion failed:', e)
      return null
    }
  }

  async function loadVersion(uuid: string, vid: string): Promise<ProjectVersion | null> {
    try {
      const res = await $fetch<{ version: ProjectVersion }>(
        `/comfynext/projects/${encodeURIComponent(uuid)}/versions/${encodeURIComponent(vid)}`,
      )
      return res.version ?? null
    } catch (e) {
      console.warn('[useProjects] loadVersion failed:', e)
      return null
    }
  }

  async function renameProject(uuid: string, name: string): Promise<void> {
    try {
      await $fetch(`/comfynext/projects/${encodeURIComponent(uuid)}`, { method: 'PUT', body: { name } })
    } catch (e) {
      console.warn('[useProjects] rename failed:', e)
    }
  }

  async function deleteProject(uuid: string): Promise<void> {
    try {
      await $fetch(`/comfynext/projects/${encodeURIComponent(uuid)}`, { method: 'DELETE' })
    } catch (e) {
      console.warn('[useProjects] delete failed:', e)
    }
  }

  return { listProjects, loadProject, saveVersion, loadVersion, renameProject, deleteProject }
}
