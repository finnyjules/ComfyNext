export interface RecentProject {
  workflowId: string
  name: string
  promptIds: string[] // all prompt IDs for this project (most recent first)
  images: { filename: string; subfolder: string; type: string }[] // last 3 images across all runs
  lastTimestamp: number
  runCount: number
}

// `recentProjects` is the first 10 for the home row; `allProjects` is the full
// list (same data, unsliced) for the "All projects" grid.
const recentProjects = ref<RecentProject[]>([])
const allProjects = ref<RecentProject[]>([])
const loading = ref(false)
let fetchedOnce = false

function deriveProjectName(classTypes: string[]): string {
  // Pick the most descriptive node type as the project name
  const ignore = new Set(['PreviewImage', 'SaveImage', 'LoadImage', 'LoadCheckpoint', 'CLIPTextEncode', 'KSampler', 'VAEDecode', 'VAELoader', 'CLIPLoader'])
  const meaningful = classTypes.filter((t) => !ignore.has(t))
  if (meaningful.length > 0) {
    // Format: "NodeType" → "Node Type"
    return meaningful[0].replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  }
  return classTypes[0]?.replace(/([a-z])([A-Z])/g, '$1 $2') || 'Workflow'
}

function getSavedNames(): Record<string, string> {
  if (import.meta.server) return {}
  try {
    return JSON.parse(localStorage.getItem('comfynext:project-names') || '{}')
  }
  catch { return {} }
}

function persistNames(names: Record<string, string>) {
  if (import.meta.server) return
  localStorage.setItem('comfynext:project-names', JSON.stringify(names))
}

export function useRecentProjects() {
  function thumbnailUrl(img: { filename: string; subfolder: string; type: string }): string {
    const params = new URLSearchParams({ filename: img.filename, type: img.type })
    if (img.subfolder) params.set('subfolder', img.subfolder)
    return `/view?${params}`
  }

  function timeAgo(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return 'Yesterday'
    return `${days}d ago`
  }

  async function fetchRecentProjects() {
    if (fetchedOnce && recentProjects.value.length > 0) return
    loading.value = true
    try {
      const res = await fetch('/history')
      const data = (await res.json()) as Record<string, any>

      // Parse all executions
      interface Execution {
        promptId: string
        workflowId: string
        name: string
        images: { filename: string; subfolder: string; type: string }[]
        timestamp: number
      }
      const executions: Execution[] = []

      for (const [promptId, entry] of Object.entries(data)) {
        const e = entry as any
        if (!e.status?.completed) continue

        const images: { filename: string; subfolder: string; type: string }[] = []
        if (e.outputs) {
          for (const nodeOutput of Object.values(e.outputs) as any[]) {
            if ((nodeOutput as any).images) images.push(...(nodeOutput as any).images)
          }
        }
        if (images.length === 0) continue

        const messages = e.status?.messages ?? []
        const startMsg = messages.find((m: any) => m[0] === 'execution_start')
        const timestamp = startMsg?.[1]?.timestamp ?? 0

        // Get workflow ID or create fingerprint
        const prompt = e.prompt ?? []
        const nodes = prompt[2] ?? {}
        const workflow = prompt[3]?.extra_pnginfo?.workflow ?? {}
        const workflowId = workflow.extra?.projectUuid
          || [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))].sort().join(',')

        const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))]
        const name = deriveProjectName(classTypes)

        executions.push({ promptId, workflowId, name, images, timestamp })
      }

      // Sort by timestamp (most recent first)
      executions.sort((a, b) => b.timestamp - a.timestamp)

      // Group by workflowId
      const groups = new Map<string, Execution[]>()
      for (const exec of executions) {
        const group = groups.get(exec.workflowId) || []
        group.push(exec)
        groups.set(exec.workflowId, group)
      }

      // Build project cards — collect last 3 images across all runs
      const projects: RecentProject[] = []
      for (const [workflowId, execs] of groups) {
        const allImages: { filename: string; subfolder: string; type: string }[] = []
        for (const exec of execs) {
          for (const img of exec.images) {
            allImages.push(img)
            if (allImages.length >= 3) break
          }
          if (allImages.length >= 3) break
        }
        const savedNames = getSavedNames()
        projects.push({
          workflowId,
          name: savedNames[workflowId] || execs[0].name,
          promptIds: execs.map((e) => e.promptId),
          images: allImages,
          lastTimestamp: execs[0].timestamp,
          runCount: execs.length,
        })
      }

      // Sort projects by most recent activity
      projects.sort((a, b) => b.lastTimestamp - a.lastTimestamp)

      // Overlay durable projects (Phase 0). They key off the same projectUuid as
      // workflowId. Durable name wins; a durable project not present in /history
      // (e.g. saved but not yet run) is appended. History stays the backbone and
      // thumbnail source until covers + version bodies fill in. Best-effort: if
      // the endpoint is absent (older ComfyUI), the history list stands.
      try {
        const durable = await useProjects().listProjects()
        if (durable.length) {
          const byId = new Map(projects.map((p) => [p.workflowId, p]))
          for (const d of durable) {
            const existing = byId.get(d.uuid)
            if (existing) {
              if (d.name) existing.name = d.name
            } else {
              projects.push({
                workflowId: d.uuid,
                name: d.name || 'Untitled project',
                promptIds: [],
                images: [],
                lastTimestamp: d.updatedAt || 0,
                runCount: 0,
              })
            }
          }
          projects.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
        }
      } catch { /* durable projects optional — history list stands */ }

      allProjects.value = projects
      recentProjects.value = projects.slice(0, 10)

      fetchedOnce = true
    }
    catch (err) {
      console.error('[useRecentProjects] Failed to fetch:', err)
    }
    finally {
      loading.value = false
    }
  }

  function refresh() {
    fetchedOnce = false
    fetchRecentProjects()
  }

  function setProjectName(workflowId: string, name: string) {
    const names = getSavedNames()
    names[workflowId] = name
    persistNames(names)
    // Update in-memory (both lists share the same objects, but guard anyway)
    for (const list of [recentProjects.value, allProjects.value]) {
      const project = list.find((p) => p.workflowId === workflowId)
      if (project) project.name = name
    }
  }

  return {
    recentProjects,
    allProjects,
    loading,
    thumbnailUrl,
    timeAgo,
    fetchRecentProjects,
    refresh,
    setProjectName,
  }
}
