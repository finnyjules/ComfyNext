export type TabStatus = 'idle' | 'running' | 'done'

export interface Tab {
  id: string
  label: string
  type: 'home' | 'project' | 'assets' | 'community' | 'app' | 'train' | 'template-editor' | 'all-projects'
  closable: boolean
  status?: TabStatus
  progress?: number // 0-100, only used when status is 'running'
  workflowId?: string // links this tab to a recent project
  promptId?: string // most recent execution's promptId (for workflow restore)
  projectUuid?: string // stable UUID for grouping all runs from this tab
  appId?: string // for 'app' tabs — which single-purpose surface is being run
  templateEditId?: string // for 'template-editor' tabs — which template is being edited
  seedNodeType?: string // for fresh 'project' tabs — generator node to drop on open (skips the start-picker)
}

const homeTab: Tab = {
  id: 'home',
  label: 'Home',
  type: 'home',
  closable: false,
}

// Restore tabs from sessionStorage on load
function loadPersistedTabs(): { tabs: Tab[], activeTabId: string, projectCounter: number } {
  if (import.meta.server) return { tabs: [homeTab], activeTabId: 'home', projectCounter: 0 }
  try {
    const saved = sessionStorage.getItem('sailor:tabs')
    if (saved) {
      const data = JSON.parse(saved)
      // Ensure home tab is always present
      const restoredTabs: Tab[] = data.tabs || []
      if (!restoredTabs.find(t => t.id === 'home')) {
        restoredTabs.unshift(homeTab)
      }
      // Reset running status on reload (executions don't survive)
      for (const tab of restoredTabs) {
        if (tab.status === 'running') {
          tab.status = 'idle'
          tab.progress = undefined
        }
        // Migrate legacy 'template' tabs (pre-Apps rename) so existing sessions
        // don't end up with a tab the layout can't render.
        const legacyType = (tab as any).type
        const legacyId = (tab as any).templateId
        if (legacyType === 'template') {
          tab.type = 'app'
          if (legacyId) {
            tab.appId = legacyId
            tab.id = `app-${legacyId}`
          }
          delete (tab as any).templateId
        }
        // Defunct: 'template-editor' tabs were retired when the visual editor
        // moved into the SmartLayout node's modal. Drop any persisted ones so
        // they don't render as a broken empty pane.
        ;(tab as any)._defunct = (tab as any).type === 'template-editor'
      }
      // Filter out any tabs flagged defunct by the migration block above.
      const cleanedTabs = restoredTabs.filter(t => !(t as any)._defunct)
      const activeId = cleanedTabs.find(t => t.id === data.activeTabId) ? data.activeTabId : 'home'
      return { tabs: cleanedTabs, activeTabId: activeId, projectCounter: data.projectCounter || 0 }
    }
  }
  catch {}
  return { tabs: [homeTab], activeTabId: 'home', projectCounter: 0 }
}

// Initial state matches what the server renders (home only). The persisted
// session state is restored AFTER hydration (see restorePersistedTabsOnce,
// called from plugins/tabs-restore.client.ts on app:mounted): restoring at
// module scope ran before hydration, so the client's first render disagreed
// with the SSR HTML and every tab-dependent v-if/class in the layout logged
// "Hydration completed but contains mismatches".
const tabs = ref<Tab[]>([homeTab])
const activeTabId = ref('home')
let projectCounter = 0

let tabsRestored = false
export function restorePersistedTabsOnce() {
  if (tabsRestored || import.meta.server) return
  tabsRestored = true
  const persisted = loadPersistedTabs()
  // Tabs opened before restore (e.g. a deep link during setup) win over the
  // persisted session: keep them and keep their active selection.
  const openedEarly = tabs.value.filter(t => t.id !== 'home')
  const merged = [...persisted.tabs]
  for (const t of openedEarly) {
    if (!merged.find(m => m.id === t.id)) merged.push(t)
  }
  tabs.value = merged
  activeTabId.value = activeTabId.value !== 'home' ? activeTabId.value : persisted.activeTabId
  projectCounter = Math.max(projectCounter, persisted.projectCounter)
}

function persistTabs() {
  if (import.meta.server) return
  try {
    sessionStorage.setItem('sailor:tabs', JSON.stringify({
      tabs: tabs.value,
      activeTabId: activeTabId.value,
      projectCounter,
    }))
  }
  catch {}
}

// Auto-persist on any change
watch([tabs, activeTabId], persistTabs, { deep: true })

export function useTabs() {
  const activeTab = computed(() =>
    tabs.value.find((t) => t.id === activeTabId.value) ?? homeTab,
  )

  function openTab(opts: { type: 'project' | 'assets' | 'community' | 'app' | 'train' | 'template-editor' | 'all-projects'; label?: string; workflowId?: string; promptId?: string; projectUuid?: string; appId?: string; templateEditId?: string; seedNodeType?: string }) {
    // Template editor: one tab per template id, switch to existing if open.
    if (opts.type === 'template-editor' && opts.templateEditId) {
      const existing = tabs.value.find((t) => t.type === 'template-editor' && t.templateEditId === opts.templateEditId)
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: `tplEdit-${opts.templateEditId}`,
        label: opts.label ?? 'Template',
        type: 'template-editor',
        templateEditId: opts.templateEditId,
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    // Apps: open one tab per appId, switch to existing if already open.
    if (opts.type === 'app' && opts.appId) {
      const existing = tabs.value.find((t) => t.type === 'app' && t.appId === opts.appId)
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: `app-${opts.appId}`,
        label: opts.label ?? 'App',
        type: 'app',
        appId: opts.appId,
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    // Singleton tabs: if an assets tab already exists, just switch to it
    if (opts.type === 'assets') {
      const existing = tabs.value.find((t) => t.type === 'assets')
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: 'assets',
        label: opts.label ?? 'Assets',
        type: 'assets',
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    if (opts.type === 'community') {
      const existing = tabs.value.find((t) => t.type === 'community')
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: 'community',
        label: opts.label ?? 'Community',
        type: 'community',
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    if (opts.type === 'all-projects') {
      const existing = tabs.value.find((t) => t.type === 'all-projects')
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: 'all-projects',
        label: opts.label ?? 'All projects',
        type: 'all-projects',
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    if (opts.type === 'train') {
      const existing = tabs.value.find((t) => t.type === 'train')
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: 'train',
        label: opts.label ?? 'Create a Style',
        type: 'train',
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }

    projectCounter++
    const label =
      opts.label ?? (projectCounter === 1 ? 'New Project' : `New Project ${projectCounter}`)
    const tab: Tab = {
      id: `project-${projectCounter}`,
      label,
      type: opts.type,
      closable: true,
      status: 'idle',
      workflowId: opts.workflowId,
      promptId: opts.promptId,
      projectUuid: opts.projectUuid || crypto.randomUUID(),
      seedNodeType: opts.seedNodeType,
    }
    tabs.value.push(tab)
    activeTabId.value = tab.id
    return tab
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1 || !tabs.value[idx].closable) return

    tabs.value.splice(idx, 1)
    if (activeTabId.value === id) {
      activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id ?? 'home'
    }
  }

  function setActiveTab(id: string) {
    activeTabId.value = id
  }

  function updateTabStatus(id: string, status: TabStatus, progress?: number) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) {
      tab.status = status
      if (progress !== undefined) tab.progress = progress
    }
  }

  function renameTab(id: string, newLabel: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (tab && newLabel.trim()) {
      tab.label = newLabel.trim()
    }
  }

  const runningCount = computed(() =>
    tabs.value.filter((t) => t.status === 'running').length,
  )

  return { tabs, activeTabId, activeTab, openTab, closeTab, setActiveTab, updateTabStatus, renameTab, runningCount }
}
