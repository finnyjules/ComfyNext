/**
 * useProjects — client API for durable server-side Projects (Phase 0).
 *
 * Thin typed wrapper over the /sailor/projects endpoints implemented in
 * comfy_extras/nodes_sailor_projects.py (proxied to ComfyUI like the rest of
 * /sailor/*). Every call degrades gracefully — a missing endpoint (older
 * ComfyUI without the module) or a network error resolves to an empty/falsy
 * result rather than throwing, so callers can treat durable projects as an
 * enrichment layer over the existing /history flow.
 *
 * See docs/plans/2026-06-02-phase0-project-persistence-spec.md.
 */
import type { GenerationRecord, GenOutput } from '~/lib/generations'

export interface ProjectMeta {
  uuid: string
  name: string | null
  // Preview images stamped from the saved doc (studio/Frame renders); the
  // string form never shipped but stays tolerated in old project.json files.
  cover: GenOutput[] | string | null
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
  cover: GenOutput[] | string | null
  createdAt: number
  updatedAt: number
  currentVersionId: string | null
  versionIndex: VersionMeta[]
}

export interface SpendSummary {
  month: { usd: number; credits: number }
  total: { usd: number; credits: number }
  byProject: { uuid: string; usd: number; credits: number }[]
}

export function useProjects() {
  async function listProjects(): Promise<ProjectMeta[]> {
    try {
      const res = await $fetch<{ projects: ProjectMeta[] }>('/sailor/projects')
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
      return await $fetch(`/sailor/projects/${encodeURIComponent(uuid)}`)
    } catch (e) {
      console.warn('[useProjects] load failed:', e)
      return null
    }
  }

  /** Snapshot the whole project as a new version; auto-creates the project.
   *  Returns the version id on success, 'stale' when the backend rejected a
   *  rolling `current` write because the stored copy carries a NEWER
   *  workflow.savedAt (HTTP 409 — another window saved more recently; this
   *  window's content must not clobber it), or null for any other failure. */
  async function saveVersion(
    uuid: string,
    version: Partial<ProjectVersion>,
    projectName?: string,
  ): Promise<string | 'stale' | null> {
    try {
      // Serialize once so we can decide on `keepalive`: it lets the request
      // survive the page unloading (saveVersion fires from beforeunload, where
      // a plain fetch is routinely killed mid-flight — the durable copy then
      // silently lags behind what the user last saw). Browsers cap in-flight
      // keepalive bodies at ~64 KiB and REJECT larger ones outright, so big
      // docs post without it (the debounced continuous autosave usually
      // persisted those moments earlier anyway).
      const raw = JSON.stringify({ projectName, version })
      const res = await $fetch<{ id: string }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/versions`,
        {
          method: 'POST',
          body: raw,
          headers: { 'content-type': 'application/json' },
          keepalive: raw.length < 60_000,
        },
      )
      return res.id ?? null
    } catch (e: any) {
      // 409 = stale-save rejection (workflow.savedAt older than stored) —
      // distinct from ordinary failures so callers can tell the user to
      // reload rather than retoast a generic autosave warning.
      if (e?.statusCode === 409 || e?.status === 409 || e?.response?.status === 409) {
        console.warn('[useProjects] saveVersion rejected as stale:', e?.data ?? e)
        return 'stale'
      }
      console.warn('[useProjects] saveVersion failed:', e)
      return null
    }
  }

  async function loadVersion(uuid: string, vid: string): Promise<ProjectVersion | null> {
    try {
      const res = await $fetch<{ version: ProjectVersion }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/versions/${encodeURIComponent(vid)}`,
      )
      return res.version ?? null
    } catch (e) {
      console.warn('[useProjects] loadVersion failed:', e)
      return null
    }
  }

  async function renameProject(uuid: string, name: string): Promise<void> {
    try {
      await $fetch(`/sailor/projects/${encodeURIComponent(uuid)}`, { method: 'PUT', body: { name } })
    } catch (e) {
      console.warn('[useProjects] rename failed:', e)
    }
  }

  /** Stamp the project's preview images (derived from the saved doc — see
   *  ~/lib/projectCover). Fire-and-forget safe: failures only warn. */
  async function setProjectCover(uuid: string, cover: GenOutput[]): Promise<void> {
    try {
      await $fetch(`/sailor/projects/${encodeURIComponent(uuid)}`, { method: 'PUT', body: { cover } })
    } catch (e) {
      console.warn('[useProjects] setProjectCover failed:', e)
    }
  }

  async function deleteProject(uuid: string): Promise<void> {
    try {
      await $fetch(`/sailor/projects/${encodeURIComponent(uuid)}`, { method: 'DELETE' })
    } catch (e) {
      console.warn('[useProjects] delete failed:', e)
    }
  }

  /** Record one completed run (also feeds the global spend ledger server-side).
   *  Fire-and-forget safe: failures only warn. */
  async function saveGeneration(
    uuid: string,
    generation: GenerationRecord,
    projectName?: string,
  ): Promise<string | null> {
    try {
      const res = await $fetch<{ id: string }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/generations`,
        { method: 'POST', body: { projectName, generation } },
      )
      return res.id ?? null
    } catch (e) {
      console.warn('[useProjects] saveGeneration failed:', e)
      return null
    }
  }

  async function listGenerations(uuid: string): Promise<GenerationRecord[]> {
    try {
      const res = await $fetch<{ generations: GenerationRecord[] }>(
        `/sailor/projects/${encodeURIComponent(uuid)}/generations`,
      )
      return res.generations ?? []
    } catch (e) {
      console.warn('[useProjects] listGenerations failed:', e)
      return []
    }
  }

  async function fetchSpendSummary(): Promise<SpendSummary | null> {
    try {
      return await $fetch<SpendSummary>('/sailor/spend/summary')
    } catch (e) {
      console.warn('[useProjects] spend summary failed:', e)
      return null
    }
  }

  return { listProjects, loadProject, saveVersion, loadVersion, renameProject, setProjectCover, deleteProject, saveGeneration, listGenerations, fetchSpendSummary }
}
