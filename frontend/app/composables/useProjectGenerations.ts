import { ref } from 'vue'
import { extractOutputFiles } from '~/lib/generations'

// Every saved generation in a project, grouped by project. Unlike
// useRecentProjects (which caps at 3 images for the home cards), this keeps the
// FULL list — each completed /history run is one generation ("take"), so this
// is the durable record of everything a project has produced. Used by the
// Assets panel.

export interface GenAsset {
  kind: 'image' | 'video' | 'audio'
  filename: string
  subfolder: string
  type: string // 'output' | 'temp' | 'input'
  promptId: string
  timestamp: number
  usd?: number | null
}

export interface ProjectGenerations {
  workflowId: string
  name: string
  generations: GenAsset[] // newest first
  lastTimestamp: number
}

const generationsByProject = ref<ProjectGenerations[]>([])
const loading = ref(false)
let fetchedOnce = false

// Mirror of useRecentProjects' name derivation so projects read the same way.
function deriveProjectName(classTypes: string[]): string {
  const ignore = new Set(['PreviewImage', 'SaveImage', 'LoadImage', 'LoadCheckpoint', 'CLIPTextEncode', 'KSampler', 'VAEDecode', 'VAELoader', 'CLIPLoader'])
  const meaningful = classTypes.filter((t) => !ignore.has(t))
  if (meaningful.length > 0) {
    return meaningful[0]!.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  }
  return classTypes[0]?.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workflow'
}

function getSavedNames(): Record<string, string> {
  if (import.meta.server) return {}
  try { return JSON.parse(localStorage.getItem('comfynext:project-names') || '{}') }
  catch { return {} }
}

export function useProjectGenerations() {
  function viewUrl(a: { filename: string; subfolder: string; type: string }): string {
    const params = new URLSearchParams({ filename: a.filename, type: a.type || 'output' })
    if (a.subfolder) params.set('subfolder', a.subfolder)
    return `/view?${params}`
  }

  async function fetchGenerations(force = false) {
    if (!force && fetchedOnce && generationsByProject.value.length) return
    loading.value = true
    try {
      const res = await fetch('/history')
      const data = (await res.json()) as Record<string, any>
      const savedNames = getSavedNames()

      interface Exec { promptId: string; workflowId: string; name: string; timestamp: number; assets: GenAsset[] }
      const execs: Exec[] = []

      for (const [promptId, entry] of Object.entries(data)) {
        const e = entry as any
        if (!e.status?.completed) continue

        const startMsg = (e.status?.messages ?? []).find((m: any) => m[0] === 'execution_start')
        const timestamp = startMsg?.[1]?.timestamp ?? 0

        const prompt = e.prompt ?? []
        const nodes = prompt[2] ?? {}
        const workflow = prompt[3]?.extra_pnginfo?.workflow ?? {}
        const workflowId = workflow.extra?.projectUuid
          || [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))].sort().join(',')
        const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))] as string[]

        const assets: GenAsset[] = []
        for (const nodeOut of Object.values(e.outputs ?? {})) {
          for (const o of extractOutputFiles(nodeOut)) {
            assets.push({ ...o, promptId, timestamp })
          }
        }
        if (!assets.length) continue
        execs.push({ promptId, workflowId, name: savedNames[workflowId] || deriveProjectName(classTypes), timestamp, assets })
      }

      execs.sort((a, b) => b.timestamp - a.timestamp)

      const groups = new Map<string, ProjectGenerations>()
      for (const ex of execs) {
        let g = groups.get(ex.workflowId)
        if (!g) {
          g = { workflowId: ex.workflowId, name: ex.name, generations: [], lastTimestamp: ex.timestamp }
          groups.set(ex.workflowId, g)
        }
        g.generations.push(...ex.assets)
      }

      generationsByProject.value = [...groups.values()].sort((a, b) => b.lastTimestamp - a.lastTimestamp)
      fetchedOnce = true
    }
    catch (err) {
      console.error('[useProjectGenerations] fetch failed:', err)
    }
    finally {
      loading.value = false
    }
  }

  function refresh() { fetchGenerations(true) }

  return { generationsByProject, loading, fetchGenerations, refresh, viewUrl }
}
