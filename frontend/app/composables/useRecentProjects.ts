import { historyEntryToRecord, type GenOutput } from '~/lib/generations'
import { buildPreviewImages } from '~/lib/projectCover'

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
    return JSON.parse(localStorage.getItem('sailor:project-names') || '{}')
  }
  catch { return {} }
}

function persistNames(names: Record<string, string>) {
  if (import.meta.server) return
  localStorage.setItem('sailor:project-names', JSON.stringify(names))
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
      const savedNames = getSavedNames()
      const { listProjects, listGenerations, saveGeneration } = useProjects()
      const projects: RecentProject[] = []
      const durableIds = new Set<string>()
      const recordedPromptIds = new Set<string>()

      // 1) Durable projects are the primary list — names + thumbnails from
      // their generation records, which survive ComfyUI restarts.
      const durable = await listProjects()
      await Promise.all(durable.map(async (d) => {
        durableIds.add(d.uuid)
        const gens = await listGenerations(d.uuid)
        // Paid renders (type 'output') headline the card; studio/Frame assets
        // recorded as generations (type 'input' — recordAsset) fill behind
        // them, and the doc-derived cover (stamped at save time) is the last
        // resort so pure-studio projects aren't blank.
        const outputImages: GenOutput[] = []
        const inputAssets: GenOutput[] = []
        for (const g of gens) {
          if (g.promptId) recordedPromptIds.add(g.promptId)
          for (const o of g.outputs || []) {
            if (o.kind !== 'image') continue
            if (o.type === 'output') outputImages.push(o)
            else inputAssets.push(o)
          }
        }
        const cover: GenOutput[] = Array.isArray(d.cover)
          ? d.cover.filter((c): c is GenOutput => !!c && typeof c.filename === 'string' && (!c.kind || c.kind === 'image'))
              .map((c) => ({ kind: c.kind || 'image', filename: c.filename, subfolder: c.subfolder || '', type: c.type || 'input' }))
          : []
        const images = buildPreviewImages([outputImages, inputAssets, cover])
        projects.push({
          workflowId: d.uuid,
          name: d.name || savedNames[d.uuid] || 'Untitled project',
          promptIds: gens.map((g) => g.promptId).filter(Boolean),
          images,
          lastTimestamp: Math.max(d.updatedAt || 0, gens[0]?.ts || 0),
          runCount: gens.length,
        })
      }))

      // 2) /history fallback for pre-durable work + backfill of unrecorded
      // runs into their durable project (idempotent — server dedups by
      // promptId, so re-posting on every Home load is harmless).
      try {
        const res = await fetch('/history')
        const data = (await res.json()) as Record<string, any>
        const byFingerprint = new Map<string, RecentProject>()
        for (const [promptId, entry] of Object.entries(data)) {
          const parsed = historyEntryToRecord(promptId, entry)
          if (!parsed) continue
          if (parsed.projectUuid && durableIds.has(parsed.projectUuid)) {
            if (!recordedPromptIds.has(promptId)) {
              // Lazy migration: persist this run before history forgets it.
              saveGeneration(parsed.projectUuid, parsed.record)
            }
            continue // already represented by its durable project card
          }
          const e = entry as any
          const nodes = (e.prompt ?? [])[2] ?? {}
          const classTypes = [...new Set(Object.values(nodes).map((n: any) => n.class_type || ''))] as string[]
          const workflowId = parsed.projectUuid || classTypes.filter(Boolean).sort().join(',')
          let p = byFingerprint.get(workflowId)
          if (!p) {
            p = {
              workflowId,
              name: savedNames[workflowId] || deriveProjectName(classTypes),
              promptIds: [],
              images: [],
              lastTimestamp: parsed.record.ts,
              runCount: 0,
            }
            byFingerprint.set(workflowId, p)
          }
          p.promptIds.push(promptId)
          p.runCount++
          p.lastTimestamp = Math.max(p.lastTimestamp, parsed.record.ts)
          for (const o of parsed.record.outputs) {
            if (o.kind === 'image' && p.images.length < 3) p.images.push(o)
          }
        }
        projects.push(...byFingerprint.values())
      } catch { /* history unreachable — durable list stands */ }

      projects.sort((a, b) => b.lastTimestamp - a.lastTimestamp)
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
    persistNames(names) // offline fallback — server below is the source of truth
    // History-fingerprint ids (comma-joined class types, pre-uuid projects)
    // must not become junk server projects.
    if (workflowId && !workflowId.includes(',')) {
      useProjects().renameProject(workflowId, name)
    }
    // Update in-memory (both lists share the same objects, but guard anyway)
    for (const list of [recentProjects.value, allProjects.value]) {
      const project = list.find((p) => p.workflowId === workflowId)
      if (project) project.name = name
    }
  }

  // Write-through for the lazy cover backfill (useCoverBackfill): update the
  // blank card in BOTH shared lists so the grid and the Home row repaint.
  // Guarded to blank cards only — a race with a real fetch never downgrades
  // generation thumbnails to doc-derived ones.
  function applyBackfilledImages(workflowId: string, images: RecentProject['images']) {
    for (const list of [recentProjects.value, allProjects.value]) {
      const project = list.find((p) => p.workflowId === workflowId)
      if (project && project.images.length === 0) project.images = images
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
    applyBackfilledImages,
  }
}
