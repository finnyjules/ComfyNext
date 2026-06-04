<script setup lang="ts">
// force HMR reload
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { ARTIFACT_NODE_COMPONENTS, ARTIFACT_NODE_FOR_OUTPUT, fetchObjectInfo, getVueFlowType, getWidgetDefs, isSubgraphType, subgraphToLiteGraph, useVueNodes } from '~/composables/useVueNodes'
import { useSubgraphNavigation } from '~/composables/useSubgraphNavigation'
import { useCanvasHistory } from '~/composables/useCanvasHistory'
import { useCanvasGroups, GROUP_COLORS, type CanvasGroup } from '~/composables/useCanvasGroups'
import { useCanvasAnnotations, STICKY_COLORS, type Annotation, type ArrowEndpoint } from '~/composables/useCanvasAnnotations'
import { applyArtifactLocks, applyVariantFanOut, backfillStandaloneArtifactImages, buildFilteredWorkflow, collectKeepSet, realignWidgetValues, setNamedWidget } from '~/composables/useFilteredPrompt'
import { type LocalLayer, ensureLayerFonts, ensureLayerImages, bakeOverlay, createImageLayer } from '~/composables/useCompositorLayers'
import { resolveClipSource, type ClipSource } from '~~/shared/timeline/resolveClipSource'
import { useNodeSearch } from '~/composables/useNodeSearch'
import { buildTake, appendTake, takeHasContent } from '~/composables/useTakes'
import ComfyNode from '~/components/vue-canvas/ComfyNode.vue'
import ComfyNoteNode from '~/components/vue-canvas/ComfyNoteNode.vue'
import ComfyEdge from '~/components/vue-canvas/ComfyEdge.vue'
import ComfyGateNode from '~/components/vue-canvas/ComfyGateNode.vue'
import ArtifactImageNode from '~/components/vue-canvas/ArtifactImageNode.vue'
import ArtifactTextNode from '~/components/vue-canvas/ArtifactTextNode.vue'
import ArtifactAudioNode from '~/components/vue-canvas/ArtifactAudioNode.vue'
import ArtifactVideoNode from '~/components/vue-canvas/ArtifactVideoNode.vue'
import ArtifactFrameNode from '~/components/vue-canvas/ArtifactFrameNode.vue'
import ArtifactTimelineNode from '~/components/vue-canvas/ArtifactTimelineNode.vue'
import SubgraphIONode from '~/components/vue-canvas/SubgraphIONode.vue'
import SubgraphBreadcrumb from '~/components/vue-canvas/SubgraphBreadcrumb.vue'
import CanvasGroupView from '~/components/vue-canvas/CanvasGroup.vue'
import StickyAnnotation from '~/components/vue-canvas/StickyAnnotation.vue'
import ChecklistAnnotationView from '~/components/vue-canvas/ChecklistAnnotation.vue'
import PinImageAnnotationView from '~/components/vue-canvas/PinImageAnnotation.vue'
import PinResultAnnotationView from '~/components/vue-canvas/PinResultAnnotation.vue'
import ArrowsLayer, { type ResolvedArrow } from '~/components/vue-canvas/ArrowsLayer.vue'
import CanvasContextMenu, { type MenuItem } from '~/components/vue-canvas/CanvasContextMenu.vue'
import { Play, EyeOff, Ban, Copy, Trash2, Group, SquareDashedMousePointer, Palette, Edit3, Frame, PlusSquare, Boxes, ChevronsUpDown, ChevronsDownUp, Lock, Unlock, Flag, StickyNote, ListChecks, Image as ImageIcon, ArrowRight } from 'lucide-vue-next'
import { useBlockLibrary } from '~/composables/useBlockLibrary'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const props = defineProps<{
  workflow: any
  activeTool?: string // 'select' | 'hand'
}>()

// Groups round-trip through useVueNodes via a bridge object. Methods are
// reassigned below once useCanvasGroups is instantiated; this dance avoids
// the circular dep (useVueNodes wants the bridge, useCanvasGroups wants
// the nodes ref that useVueNodes creates).
const groupsBridge = { load: (_: any[] | undefined | null) => {}, export: () => [] as any[] }
// Same dance for annotations — they live under workflow.extra.comfynext.
const annotationsBridge = { load: (_: unknown) => {}, export: () => ({}) as unknown }

const { nodes, edges, objectInfo, convertFromLiteGraph, convertToLiteGraph } = useVueNodes({ groupsBridge, annotationsBridge })

const {
  groups,
  createGroupFromSelection,
  nodesInGroup,
  dragGroup,
  resizeGroup,
  updateGroup,
  deleteGroup,
  setGroups,
  toggleCollapse: toggleGroupCollapse,
  hiddenNodeIdsByGroups,
  setStatus: setGroupStatus,
  toggleLock: toggleGroupLock,
  toLiteGraph: groupsToLiteGraph,
  fromLiteGraph: groupsFromLiteGraph,
} = useCanvasGroups(nodes as any)

groupsBridge.load = (raw) => setGroups(groupsFromLiteGraph(raw))
groupsBridge.export = () => groupsToLiteGraph()

const {
  annotations,
  createSticky,
  createChecklist,
  createImagePin,
  createResultPin,
  createArrow,
  update: updateAnnotation,
  move: moveAnnotation,
  resize: resizeAnnotation,
  remove: removeAnnotation,
  removeForGroup: removeAnnotationsForGroup,
  dragGroupAttached: dragGroupAttachedAnnotations,
  setGroupAttachment,
  setAll: setAnnotations,
  exportToExtra: annotationsExportToExtra,
  loadFromExtra: annotationsLoadFromExtra,
} = useCanvasAnnotations(nodes as any)

annotationsBridge.load = (raw) => annotationsLoadFromExtra(raw)
annotationsBridge.export = () => annotationsExportToExtra()

// Make the live graph available to child nodes that need to look up upstream
// data (e.g. MaskExtractor showing its source image as a fallback preview).
provide('vueFlowNodes', nodes)
provide('vueFlowEdges', edges)
const {
  onConnect, addEdges, fitView, zoomIn: vfZoomIn, zoomOut: vfZoomOut,
  project, removeNodes, removeEdges, viewport: vfViewport, onNodeDragStop, onNodeDrag,
} = useVueFlow()

// Selection helpers — Vue Flow marks selected nodes with `selected: true`.
function getSelectedNodeIds(): string[] {
  return (nodes.value as any[]).filter(n => n.selected).map(n => n.id)
}
function getSelectedEdgeIds(): string[] {
  return (edges.value as any[]).filter(e => e.selected).map(e => e.id)
}

// Undo / redo — snapshots nodes+edges on a short debounce. The `isRestoring`
// guard prevents the watcher from snapshotting our own programmatic restore.
const history = useCanvasHistory()
let isRestoringHistory = false
let snapshotTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSnapshot() {
  if (isRestoringHistory) return
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    history.snapshot({ nodes: nodes.value as any[], edges: edges.value as any[] })
  }, 350)
}

watch([nodes, edges], scheduleSnapshot, { deep: true })

// Sync node `hidden` flag with collapsed-group membership. Vue Flow honors
// `hidden: true` by removing the node from layout AND auto-hiding any edges
// that touch it, which is exactly what we want when a group folds.
//
// We diff before assigning so we don't trigger an unnecessary update on every
// tick — the watch is deep on `groups` (collapse toggles) and `nodes`
// (positions change → membership can change).
watch(
  [groups, () => (nodes.value as any[]).map(n => `${n.id}:${n.position.x},${n.position.y}`).join('|')],
  () => {
    const hidden = hiddenNodeIdsByGroups()
    for (const n of nodes.value as any[]) {
      const shouldHide = hidden.has(n.id)
      if (!!n.hidden !== shouldHide) n.hidden = shouldHide
    }
  },
  { deep: true, immediate: true },
)

// Memoized member counts for collapsed groups so we don't re-walk all nodes
// from inside the template on every render.
const groupMemberCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}
  for (const g of groups.value) {
    counts[g.id] = nodesInGroup(g.id).length
  }
  return counts
})

// Set of collapsed group IDs for cheap membership checks during render.
const collapsedGroupIds = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const g of groups.value) if (g.collapsed) s.add(g.id)
  return s
})

// Annotations to render: skip non-arrow annotations whose attached group is
// currently collapsed (so they vanish along with their group's contents).
// Arrows handle this implicitly via endpoint resolution — a collapsed group
// still has coordinates, so arrows continue to render to the pill.
const visibleAnnotations = computed(() => {
  return annotations.value.filter(a => {
    if (a.kind === 'arrow') return true
    if (!a.attachedToGroup) return true
    return !collapsedGroupIds.value.has(a.attachedToGroup)
  })
})

// AABB-style hit test: is a point inside any group's rect? Returns the
// containing group's id, preferring the LAST one in the array (top of z-order).
function groupAtPoint(x: number, y: number): string | null {
  for (let i = groups.value.length - 1; i >= 0; i--) {
    const g = groups.value[i]!
    // Use expanded bounds for collapsed groups so an annotation dragged onto
    // the pill still recognizes the underlying group as a drop target.
    const w = g.collapsed ? (g.expandedSize?.width ?? g.width) : g.width
    const h = g.collapsed ? (g.expandedSize?.height ?? g.height) : g.height
    if (x >= g.x && x <= g.x + w && y >= g.y && y <= g.y + h) return g.id
  }
  return null
}

/**
 * Wrap moveAnnotation so that, after the move, we check whether the
 * annotation's new center lies inside a group. If yes, attach it. If it
 * moved OUT of its previously-attached group's bounds, detach.
 *
 * This gives FigJam-like behavior: drop a sticky onto a frame and it
 * "belongs" to the frame, including moving and hiding with it.
 */
function moveAnnotationWithAttach(id: string, dx: number, dy: number) {
  moveAnnotation(id, dx, dy)
  const a = annotations.value.find(x => x.id === id)
  if (!a || a.kind === 'arrow') return
  const cx = a.x + a.width / 2
  const cy = a.y + a.height / 2
  const containing = groupAtPoint(cx, cy)
  if (containing && a.attachedToGroup !== containing) {
    setGroupAttachment(id, containing)
  } else if (!containing && a.attachedToGroup) {
    setGroupAttachment(id, null)
  }
}

// ---- Arrow rendering + creation -------------------------------------------
//
// Arrow endpoints reference groups, annotations, or free points. We resolve
// each to a graph-space (x, y) and pass the list to ArrowsLayer. Resolution
// runs reactively so endpoints follow their referenced object on drag.

function resolveEndpoint(ep: ArrowEndpoint): { x: number; y: number } | null {
  if (ep.kind === 'point') return { x: ep.x, y: ep.y }
  if (ep.kind === 'group') {
    const g = groups.value.find(g => g.id === ep.id)
    if (!g) return null
    // Anchor on the title-bar center — it's the only consistent attach point
    // whether the group is collapsed (pill) or expanded.
    return { x: g.x + g.width / 2, y: g.y + 14 }
  }
  if (ep.kind === 'annotation') {
    const a = annotations.value.find(a => a.id === ep.id)
    if (!a || a.kind === 'arrow') return null
    return { x: a.x + a.width / 2, y: a.y + a.height / 2 }
  }
  return null
}

const resolvedArrows = computed<ResolvedArrow[]>(() => {
  const out: ResolvedArrow[] = []
  for (const a of annotations.value) {
    if (a.kind !== 'arrow') continue
    const from = resolveEndpoint(a.from)
    const to = resolveEndpoint(a.to)
    // Drop arrows with a dangling endpoint — they'd render at (0,0) otherwise.
    // The composable's remove paths already clean these up, but this is a
    // belt-and-suspenders guard against half-loaded state.
    if (!from || !to) continue
    out.push({
      id: a.id,
      fromX: from.x, fromY: from.y,
      toX: to.x, toY: to.y,
      label: a.label,
      color: a.color ?? '#a78bfa',
      curveOffset: a.curveOffset ?? 0,
      thickness: a.thickness ?? 2.5,
      source: a,
    })
  }
  return out
})

// Pending arrow: when set, the next click on a pane / group / annotation
// resolves the `to` endpoint and commits the arrow. ESC cancels.
const pendingArrowFrom = ref<ArrowEndpoint | null>(null)
const pendingArrowCursor = ref<{ x: number; y: number } | null>(null)

function beginArrowFromGroup(groupId: string) {
  pendingArrowFrom.value = { kind: 'group', id: groupId }
  pendingArrowCursor.value = null
}

function beginArrowFromPoint(x: number, y: number) {
  pendingArrowFrom.value = { kind: 'point', x, y }
  pendingArrowCursor.value = { x, y }
}

function cancelPendingArrow() {
  pendingArrowFrom.value = null
  pendingArrowCursor.value = null
}

function completePendingArrow(to: ArrowEndpoint) {
  if (!pendingArrowFrom.value) return
  // Don't draw an arrow to the same endpoint it came from.
  const from = pendingArrowFrom.value
  const sameGroup = from.kind === 'group' && to.kind === 'group' && from.id === to.id
  const sameAnno = from.kind === 'annotation' && to.kind === 'annotation' && from.id === to.id
  if (sameGroup || sameAnno) { cancelPendingArrow(); return }
  createArrow({ from, to })
  cancelPendingArrow()
}

// Live preview of the pending arrow — follows the mouse until the user clicks
// the second endpoint. Rendered as a faint extra entry in resolvedArrows.
const previewArrow = computed<ResolvedArrow | null>(() => {
  if (!pendingArrowFrom.value || !pendingArrowCursor.value) return null
  const from = resolveEndpoint(pendingArrowFrom.value)
  if (!from) return null
  return {
    id: '__pending__',
    fromX: from.x, fromY: from.y,
    toX: pendingArrowCursor.value.x, toY: pendingArrowCursor.value.y,
    color: '#a78bfa',
    curveOffset: 0,
    thickness: 2.5,
    source: { id: '__pending__', kind: 'arrow', from: pendingArrowFrom.value, to: { kind: 'point', x: 0, y: 0 } },
  }
})

const allRenderedArrows = computed<ResolvedArrow[]>(() => {
  if (previewArrow.value) return [...resolvedArrows.value, previewArrow.value]
  return resolvedArrows.value
})

// ---- Arrow selection + editing -------------------------------------------

const selectedArrowId = ref<string | null>(null)

function selectArrow(id: string) {
  selectedArrowId.value = id
}
function clearArrowSelection() {
  selectedArrowId.value = null
}

// Endpoint drag from ArrowsLayer: handle is reporting graph-space coords.
// We convert the endpoint to a free point (detaching from any group/annotation
// it was anchored to). The user can always redraw to re-anchor.
function onArrowEndpointDrag(id: string, which: 'from' | 'to', x: number, y: number) {
  const arrow = annotations.value.find(a => a.id === id && a.kind === 'arrow')
  if (!arrow) return
  const next = { kind: 'point' as const, x, y }
  if (which === 'from') updateAnnotation(id, { from: next } as any)
  else updateAnnotation(id, { to: next } as any)
}

// Curve handle drag: compute perpendicular offset from the from→to line and
// store it. The arrow path automatically picks up the new curve.
function onArrowCurveDrag(id: string, x: number, y: number) {
  const arrow = annotations.value.find(a => a.id === id && a.kind === 'arrow') as
    Extract<typeof annotations.value[number], { kind: 'arrow' }> | undefined
  if (!arrow) return
  const from = resolveEndpoint(arrow.from)
  const to = resolveEndpoint(arrow.to)
  if (!from || !to) return
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy)
  if (dist < 1) return
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const perpX = -dy / dist
  const perpY = dx / dist
  // Scalar projection of (drag - mid) onto the perpendicular axis.
  const offset = (x - mx) * perpX + (y - my) * perpY
  updateAnnotation(id, { curveOffset: offset } as any)
}

// Inline style toolbar position — placed above the selected arrow's curve
// midpoint, in screen coordinates (so it doesn't scale with zoom, stays
// readable). Returns null when there's no selection.
const selectedArrowToolbarPos = computed<{ left: number; top: number; color: string; thickness: number } | null>(() => {
  if (!selectedArrowId.value) return null
  const a = resolvedArrows.value.find(x => x.id === selectedArrowId.value)
  if (!a) return null
  // Curve midpoint in graph space, then transform to screen.
  const dx = a.toX - a.fromX
  const dy = a.toY - a.fromY
  const dist = Math.hypot(dx, dy) || 1
  const mx = (a.fromX + a.toX) / 2
  const my = (a.fromY + a.toY) / 2
  const px = -dy / dist
  const py = dx / dist
  const cx = mx + px * a.curveOffset
  const cy = my + py * a.curveOffset
  const zoom = vfViewport.value.zoom || 1
  const screenX = cx * zoom + vfViewport.value.x
  const screenY = cy * zoom + vfViewport.value.y
  return { left: screenX, top: screenY - 44, color: a.color, thickness: a.thickness }
})

const ARROW_PALETTE = ['#a78bfa', '#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#f87171', '#94a3b8', '#ffffff']
const ARROW_THICKNESSES = [1.5, 2.5, 4]

function setSelectedArrowColor(c: string) {
  if (!selectedArrowId.value) return
  updateAnnotation(selectedArrowId.value, { color: c } as any)
}
function setSelectedArrowThickness(t: number) {
  if (!selectedArrowId.value) return
  updateAnnotation(selectedArrowId.value, { thickness: t } as any)
}
function editSelectedArrowLabel() {
  if (!selectedArrowId.value) return
  const arrow = annotations.value.find(a => a.id === selectedArrowId.value && a.kind === 'arrow') as any
  const next = window.prompt('Arrow label', arrow?.label || '')
  if (next !== null) updateAnnotation(selectedArrowId.value, { label: next.trim() || undefined } as any)
}
function deleteSelectedArrow() {
  if (!selectedArrowId.value) return
  removeAnnotation(selectedArrowId.value)
  selectedArrowId.value = null
}

// Global keyboard: ESC cancels pending arrow; S/C/A spawn annotations at
// the cursor (or viewport center if cursor unknown). All shortcuts bail when
// focus is on a text input so they don't intercept typing in node widgets.
let lastMouseClient: { x: number; y: number } | null = null
function trackMouseClient(e: MouseEvent) { lastMouseClient = { x: e.clientX, y: e.clientY } }

function isTypingTarget(): boolean {
  const ae = document.activeElement
  if (!(ae instanceof Element)) return false
  return !!(ae.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    || ae.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
}

function onGlobalKey(e: KeyboardEvent) {
  // ESC: cancel pending arrow first, then clear arrow selection if any.
  if (e.key === 'Escape') {
    if (pendingArrowFrom.value) {
      cancelPendingArrow()
      e.preventDefault()
      return
    }
    if (selectedArrowId.value) {
      clearArrowSelection()
      e.preventDefault()
      return
    }
  }
  // Delete / Backspace removes the selected arrow. Skip when typing so we
  // don't eat text-editing keystrokes.
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedArrowId.value && !isTypingTarget()) {
    deleteSelectedArrow()
    e.preventDefault()
    return
  }
  // The rest are creation shortcuts — skip when typing or when modifier keys
  // are held (Cmd/Ctrl combos belong to undo/redo etc.).
  if (isTypingTarget()) return
  if (e.metaKey || e.ctrlKey || e.altKey) return

  // Spawn at cursor location, or viewport center if we haven't seen a mouse
  // event yet this session.
  const screen = lastMouseClient ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const spawn = project(screen)

  if (e.key === 's' || e.key === 'S') {
    createSticky({ x: spawn.x, y: spawn.y })
    e.preventDefault()
  } else if (e.key === 'c' || e.key === 'C') {
    createChecklist({ x: spawn.x, y: spawn.y })
    e.preventDefault()
  } else if (e.key === 'a' || e.key === 'A') {
    beginArrowFromPoint(spawn.x, spawn.y)
    e.preventDefault()
  }
}
onMounted(() => {
  window.addEventListener('keydown', onGlobalKey)
  window.addEventListener('mousemove', trackMouseClient)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey)
  window.removeEventListener('mousemove', trackMouseClient)
})

async function applyHistoryState(state: { nodes: any[], edges: any[] } | null) {
  if (!state) return
  isRestoringHistory = true
  // Splice in place so Vue Flow's reactivity picks up the change cleanly.
  nodes.value.splice(0, nodes.value.length, ...state.nodes)
  edges.value.splice(0, edges.value.length, ...state.edges)
  await nextTick()
  // Give the debounced snapshot a beat to skip, then release the guard.
  setTimeout(() => { isRestoringHistory = false }, 50)
}

function handleHistoryKey(e: KeyboardEvent) {
  const isUndo = (e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey
  const isRedo = (e.metaKey || e.ctrlKey) && ((e.key === 'Z' && e.shiftKey) || e.key === 'y')
  if (!isUndo && !isRedo) return

  // Don't hijack undo inside text inputs — native input-undo is more useful there.
  const ae = document.activeElement
  if (ae instanceof Element
    && (ae.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || ae.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) {
    return
  }
  e.preventDefault()
  applyHistoryState(isUndo ? history.undo() : history.redo())
}

// Tool mode: select vs hand
// Vue Flow's selection box requires selectionKeyCode === true AND panOnDrag === false
const isHandMode = computed(() => props.activeTool === 'hand')
const panOnDrag = computed(() => isHandMode.value)          // hand: left-click pans; select: false
const selectionKeyCode = computed(() => isHandMode.value ? null : true) // select: enable drag-selection; hand: disable

// Subgraph navigation
const { isInsideSubgraph, breadcrumbs, enterSubgraph, exitToLevel, saveCurrentSubgraph, reset: resetNav } = useSubgraphNavigation()
const rootWorkflow = ref<any>(null) // Full workflow with definitions

// ── Node factory ─────────────────────────────────────────────────────────────
// Single source of truth for building a fresh node's data from object_info.
// Used by drag-drop-from-sidebar, the node-search dialog, and wire splicing so
// they never drift (the port/widget derivation used to be copy-pasted).
function createNodeData(nodeType: string, position: { x: number, y: number }, widgetOverrides?: Record<string, unknown>, propertyOverrides?: Record<string, unknown>) {
  const info = objectInfo.value[nodeType]
  const widgetDefs = getWidgetDefs(nodeType)
  const vueFlowType = getVueFlowType(nodeType)
  const widgetsValues = widgetDefs.map((w: any) => w.default ?? null)
  if (widgetOverrides) {
    for (const [name, value] of Object.entries(widgetOverrides)) {
      const idx = widgetDefs.findIndex((w: any) => w.name === name)
      if (idx >= 0) widgetsValues[idx] = value
    }
  }
  return {
    id: String(Date.now()),
    type: vueFlowType,
    position,
    data: {
      nodeType,
      title: info?.display_name || nodeType,
      inputs: [
        ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
        ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
      ]
        .filter(({ s }) => {
          const specArr = Array.isArray(s) ? s : [s]
          const type = specArr[0]
          const cfg = specArr[1] || {}
          if (Array.isArray(type)) return false
          if (cfg.forceInput) return true
          return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(type))
        })
        .map(({ n, s, optional }) => ({
          name: n,
          type: Array.isArray(s) ? String(s[0]) : String(s),
          link: null,
          optional,
        })),
      outputs: (info?.output || []).map((type: string, i: number) => ({
        name: info?.output_name?.[i] || type,
        type,
        links: null,
      })),
      widgetsValues,
      widgetDefs,
      properties: { ...(propertyOverrides || {}) },
      mode: 0,
      size: [220, 120],
      category: info?.category || '',
      outputNode: !!info?.output_node,
      priceBadge: info?.price_badge || null,
      ...(nodeType === 'ComfyGateNode' ? { paused: false, promptId: null } : {}),
    },
  } as any
}

// ── Wire splicing ────────────────────────────────────────────────────────────
// Insert a node between two already-connected nodes (drop-on-wire, edge "+"),
// or after a node across all its matching output edges (artifact effect actions).
function typesCompatible(a: string, b: string): boolean {
  return a === b || a === '*' || b === '*'
}
function outputHandleFor(node: any, wantType?: string): string {
  const outs = node?.data?.outputs ?? []
  let idx = wantType ? outs.findIndex((o: any) => typesCompatible(o.type, wantType)) : -1
  if (idx < 0) idx = 0
  return `output-${idx}`
}
function inputHandleFor(node: any, wantType?: string): string {
  const ins = node?.data?.inputs ?? []
  let idx = wantType ? ins.findIndex((i: any) => typesCompatible(i.type, wantType)) : -1
  if (idx < 0) idx = 0
  return `input-${idx}`
}
function typeOfOutputHandle(node: any, handle?: string): string {
  const i = parseInt(String(handle ?? '').replace('output-', '') || '0')
  return node?.data?.outputs?.[i]?.type ?? '*'
}
function typeOfInputHandle(node: any, handle?: string): string {
  const i = parseInt(String(handle ?? '').replace('input-', '') || '0')
  return node?.data?.inputs?.[i]?.type ?? '*'
}

/** Splice a new node into an existing edge: A→B becomes A→New→B. */
async function spliceIntoEdge(edgeId: string, nodeType: string, widgetOverrides?: Record<string, unknown>) {
  const edge = (edges.value as any[]).find(e => e.id === edgeId)
  if (!edge) return
  if (!objectInfo.value[nodeType]) await fetchObjectInfo()
  const src = (nodes.value as any[]).find(n => n.id === edge.source)
  const tgt = (nodes.value as any[]).find(n => n.id === edge.target)
  if (!src || !tgt) return
  const srcOutType = typeOfOutputHandle(src, edge.sourceHandle)
  const tgtInType = typeOfInputHandle(tgt, edge.targetHandle)
  const pos = {
    x: ((src.position?.x ?? 0) + (tgt.position?.x ?? 0)) / 2 - 110,
    y: ((src.position?.y ?? 0) + (tgt.position?.y ?? 0)) / 2,
  }
  const node = createNodeData(nodeType, pos, widgetOverrides)
  const inHandle = inputHandleFor(node, srcOutType)
  const outHandle = outputHandleFor(node, tgtInType)
  nodes.value.push(node)
  // Wait for VueFlow to register the new node (and mount its handles) before
  // wiring edges to it — otherwise edges referencing it are pruned as invalid.
  await nextTick()
  removeEdges([edgeId])
  addEdges([
    { source: edge.source, sourceHandle: edge.sourceHandle, target: node.id, targetHandle: inHandle, type: 'comfy', data: { dataType: srcOutType } },
    { source: node.id, sourceHandle: outHandle, target: edge.target, targetHandle: edge.targetHandle, type: 'comfy', data: { dataType: tgtInType } },
  ])
}

/** Apply a transform after a node: feed it from the node and re-point every
 *  existing matching-type output edge through it (used by artifact-card actions
 *  like "Remove background"). If nothing was downstream, it's just appended. */
async function spliceAfterNode(nodeId: string, nodeType: string, outType = 'IMAGE', widgetOverrides?: Record<string, unknown>) {
  if (!objectInfo.value[nodeType]) await fetchObjectInfo()
  const src = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!src) return
  const srcOutHandle = outputHandleFor(src, outType)
  const downstream = (edges.value as any[]).filter(e => e.source === nodeId && e.sourceHandle === srcOutHandle)
  const pos = { x: (src.position?.x ?? 0) + 360, y: (src.position?.y ?? 0) }
  const node = createNodeData(nodeType, pos, widgetOverrides)
  const inHandle = inputHandleFor(node, outType)
  const outHandle = outputHandleFor(node, outType)
  nodes.value.push(node)
  // Wait for VueFlow to register the new node before wiring edges to it.
  await nextTick()
  const newEdges: any[] = [
    { source: nodeId, sourceHandle: srcOutHandle, target: node.id, targetHandle: inHandle, type: 'comfy', data: { dataType: outType } },
  ]
  for (const e of downstream) {
    newEdges.push({ source: node.id, sourceHandle: outHandle, target: e.target, targetHandle: e.targetHandle, type: 'comfy', data: { dataType: outType } })
  }
  if (downstream.length) removeEdges(downstream.map((e: any) => e.id))
  addEdges(newEdges)
}

/** Can this node be spliced into this edge? (compatible in/out ports, and the
 *  node isn't already an endpoint of the edge.) Shared by the splice action and
 *  the drag-over highlight so the highlight always reflects a real drop target. */
function canNodeSpliceEdge(node: any, edge: any): boolean {
  if (!node || !edge || edge.source === node.id || edge.target === node.id) return false
  const src = (nodes.value as any[]).find(n => n.id === edge.source)
  const tgt = (nodes.value as any[]).find(n => n.id === edge.target)
  if (!src || !tgt) return false
  const srcOutType = typeOfOutputHandle(src, edge.sourceHandle)
  const tgtInType = typeOfInputHandle(tgt, edge.targetHandle)
  const hasIn = (node.data?.inputs ?? []).some((i: any) => typesCompatible(i.type, srcOutType))
  const hasOut = (node.data?.outputs ?? []).some((o: any) => typesCompatible(o.type, tgtInType))
  return hasIn && hasOut
}

/** Splice an EXISTING (already-placed) node into an edge it was dragged onto. */
function spliceExistingNodeIntoEdge(nodeId: string, edgeId: string) {
  const edge = (edges.value as any[]).find(e => e.id === edgeId)
  const node = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!edge || !node || !canNodeSpliceEdge(node, edge)) return
  const src = (nodes.value as any[]).find(n => n.id === edge.source)
  const tgt = (nodes.value as any[]).find(n => n.id === edge.target)
  const srcOutType = typeOfOutputHandle(src, edge.sourceHandle)
  const tgtInType = typeOfInputHandle(tgt, edge.targetHandle)
  removeEdges([edgeId])
  addEdges([
    { source: edge.source, sourceHandle: edge.sourceHandle, target: nodeId, targetHandle: inputHandleFor(node, srcOutType), type: 'comfy', data: { dataType: srcOutType } },
    { source: nodeId, sourceHandle: outputHandleFor(node, tgtInType), target: edge.target, targetHandle: edge.targetHandle, type: 'comfy', data: { dataType: tgtInType } },
  ])
}

// Find a spliceable wire under a dragged (fully-unconnected) node, or null.
function spliceableEdgeUnderNode(node: any, event: any): string | null {
  if (!node?.id) return null
  const connected = (edges.value as any[]).some(e => e.source === node.id || e.target === node.id)
  if (connected) return null
  const x = (event as MouseEvent)?.clientX, y = (event as MouseEvent)?.clientY
  if (x == null || y == null) return null
  // elementsFromPoint sees through the dragged node to any wire beneath it.
  for (const el of (document.elementsFromPoint(x, y) as HTMLElement[])) {
    const id = el.closest?.('[data-edge-id]')?.getAttribute('data-edge-id')
    if (!id) continue
    const edge = (edges.value as any[]).find(e => e.id === id)
    if (edge && canNodeSpliceEdge(node, edge)) return id
  }
  return null
}

// Live highlight while dragging an unconnected node over a compatible wire.
onNodeDrag(({ event, node }) => {
  dragOverEdgeId.value = spliceableEdgeUnderNode(node, event)
})

// Dropping a fully-unconnected node onto a compatible wire splices it in.
onNodeDragStop(({ event, node }) => {
  const id = spliceableEdgeUnderNode(node, event)
  dragOverEdgeId.value = null
  if (id) spliceExistingNodeIntoEdge(node.id, id)
})

// Edge currently under the cursor during a node drag → drop splices into it.
const dragOverEdgeId = ref<string | null>(null)
provide('spliceDragEdgeId', dragOverEdgeId)
// Edge the "+" affordance targeted → the next node-search pick splices into it.
let pendingSpliceEdgeId: string | null = null
const { openNodeSearch } = useNodeSearch()

function handleCanvasDragOver(event: DragEvent) {
  event.preventDefault()
  const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const edgeEl = el?.closest('[data-edge-id]') as HTMLElement | null
  dragOverEdgeId.value = edgeEl?.getAttribute('data-edge-id') ?? null
}

function handleEdgeInsert(e: Event) {
  const { edgeId } = (e as CustomEvent).detail || {}
  if (!edgeId) return
  pendingSpliceEdgeId = String(edgeId)
  openNodeSearch()
}

function handleApplyEffect(e: Event) {
  const { nodeId, nodeType, output, widgetOverrides } = (e as CustomEvent).detail || {}
  if (!nodeId || !nodeType) return
  spliceAfterNode(String(nodeId), String(nodeType), output || 'IMAGE', widgetOverrides)
}

// Handle node drop from sidebar
// ── Assets panel → canvas ──────────────────────────────────────────────────
// Drop (or click) a generation/import from the Assets panel to add a loader
// node for it. Images use LoadImageOutput (output folder) or LoadImage (input);
// video/audio use their matching loaders (best-effort for output media).
interface DroppedAsset { kind: 'image' | 'video' | 'audio'; filename: string; subfolder?: string; type?: string }

function assetViewUrl(a: DroppedAsset): string {
  const p = new URLSearchParams({ filename: a.filename, type: a.type || 'output' })
  if (a.subfolder) p.set('subfolder', a.subfolder)
  p.set('t', String(Date.now()))
  return `/view?${p}`
}

async function addAssetNodeData(a: DroppedAsset, position: { x: number, y: number }) {
  const nodeType = a.kind === 'video' ? 'LoadVideo'
    : a.kind === 'audio' ? 'LoadAudio'
      : a.type === 'input' ? 'LoadImage' : 'LoadImageOutput'
  if (!objectInfo.value[nodeType]) await fetchObjectInfo()
  const widgetName = a.kind === 'video' ? 'video' : a.kind === 'audio' ? 'audio' : 'image'
  // LoadImageOutput's combo value is "subfolder/filename" when nested.
  const widgetVal = (nodeType === 'LoadImageOutput' && a.subfolder) ? `${a.subfolder}/${a.filename}` : a.filename
  const node = createNodeData(nodeType, position, { [widgetName]: widgetVal }) as any
  // Instant thumbnail for images (ArtifactImageNode renders data.images[0] first).
  if (a.kind === 'image') node.data.images = [assetViewUrl(a)]
  return node
}

async function handleAddAssetNode(e: Event) {
  const a = (e as CustomEvent<DroppedAsset>).detail
  if (!a?.filename) return
  const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  nodes.value.push(await addAssetNodeData(a, { x: center.x, y: center.y }))
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  // Assets panel drops carry our custom MIME type with a JSON payload.
  if (event.dataTransfer?.types.includes('application/x-comfynext-asset')) {
    try {
      const a = JSON.parse(event.dataTransfer.getData('application/x-comfynext-asset')) as DroppedAsset
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const position = project({ x: event.clientX - rect.left, y: event.clientY - rect.top })
      nodes.value.push(await addAssetNodeData(a, position))
    } catch { /* malformed payload — ignore */ }
    return
  }
  // Block library drops carry our custom MIME type; route them first since
  // the text/plain payload is just a fallback prefixed with "block:".
  if (event.dataTransfer?.types.includes('application/x-comfynext-block')) {
    tryHandleBlockDrop(event)
    return
  }
  const nodeType = event.dataTransfer?.getData('text/plain')
  if (!nodeType) return
  // Defensive: ignore the text/plain fallback that block drags also emit.
  if (nodeType.startsWith('block:')) return

  // Dropped onto a wire → splice the node into that connection (A→B ⇒ A→New→B).
  // Detect the edge at drop time via elementFromPoint — the dragover-tracked id
  // can be cleared by dragenter/leave bubbling races, so this is authoritative.
  const dropEl = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
  const edgeId = dropEl?.closest('[data-edge-id]')?.getAttribute('data-edge-id') || dragOverEdgeId.value
  dragOverEdgeId.value = null
  if (edgeId) {
    await spliceIntoEdge(edgeId, nodeType)
    return
  }

  // Refresh schema if we don't know this node type — protects against the
  // common case of "ComfyUI was restarted with new nodes but the cache is
  // stale," which results in a node rendering without any ports.
  if (!objectInfo.value[nodeType]) {
    await fetchObjectInfo()
  }

  const canvasEl = (event.currentTarget as HTMLElement)
  const rect = canvasEl.getBoundingClientRect()
  const position = project({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  })
  nodes.value.push(createNodeData(nodeType, position))
}

// Load workflow when prop changes (ensure object_info is ready first)
// Track the workflow identity to avoid re-processing the same object
let lastWorkflowRef: any = null
watch(
  () => props.workflow,
  async (wf) => {
    if (!wf) return
    // Skip if we're inside a subgraph (canvas is self-managing)
    // or if the workflow object hasn't actually changed
    if (isInsideSubgraph.value || wf === lastWorkflowRef) return
    lastWorkflowRef = wf
    rootWorkflow.value = wf
    resetNav()
    await fetchObjectInfo()
    convertFromLiteGraph(wf, wf.definitions)
    nextTick(() => fitView({ padding: 0.2 }))
  },
  { immediate: true },
)

// Re-apply widget defs and sync outputs if object_info loads after the initial conversion
watch(objectInfo, (info) => {
  if (!info || !Object.keys(info).length) return
  for (const n of nodes.value as any[]) {
    if (!n.data?.nodeType) continue
    const nodeInfo = info[n.data.nodeType]
    if (!nodeInfo) continue

    const updates: Record<string, any> = {}

    if (!n.data.widgetDefs?.length) {
      const defs = getWidgetDefs(n.data.nodeType)
      if (defs.length) updates.widgetDefs = defs
    }

    // Sync outputs from object_info if the node has fewer outputs than defined
    const expectedOutputs = (nodeInfo.output || []).map((type: string, i: number) => ({
      name: nodeInfo.output_name?.[i] || type,
      type,
      links: null,
    }))
    if (expectedOutputs.length > (n.data.outputs?.length || 0)) {
      // Preserve existing link data for outputs that already exist
      const merged = expectedOutputs.map((eo: any, i: number) => n.data.outputs?.[i] || eo)
      updates.outputs = merged
    }

    if (!n.data.category && nodeInfo.category) {
      updates.category = nodeInfo.category
    }
    if (!n.data.priceBadge && nodeInfo.price_badge) {
      updates.priceBadge = nodeInfo.price_badge
    }

    if (Object.keys(updates).length) {
      n.data = { ...n.data, ...updates }
    }
  }
})

// Handle new connections
onConnect((params) => {
  const sourceNode = (nodes.value as any[]).find(n => n.id === params.source)
  const outputIndex = parseInt(params.sourceHandle?.replace('output-', '') || '0')
  const dataType = sourceNode?.data?.outputs?.[outputIndex]?.type || '*'
  addEdges([{ ...params, type: 'comfy', data: { dataType } }])
})

// Listen for addNode events from NodeSearchDialog
async function handleAddNode(e: Event) {
  const detail = (e as CustomEvent<{ nodeType: string, widgetOverrides?: Record<string, unknown>, propertyOverrides?: Record<string, unknown> }>).detail
  const { nodeType, widgetOverrides, propertyOverrides } = detail

  // Refresh schema if we don't know this node type.
  if (!objectInfo.value[nodeType]) {
    await fetchObjectInfo()
  }

  // If the search was opened from an edge "+", splice into that edge instead
  // of dropping the node at viewport center.
  if (pendingSpliceEdgeId) {
    const edgeId = pendingSpliceEdgeId
    pendingSpliceEdgeId = null
    await spliceIntoEdge(edgeId, nodeType, widgetOverrides)
    return
  }

  const center = project({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  nodes.value.push(createNodeData(nodeType, { x: center.x, y: center.y }, widgetOverrides, propertyOverrides))
}

// Subgraph navigation: double-click to enter
function handleNodeDoubleClick({ node }: { node: any }) {
  if (!node.data?.isSubgraph || !node.data?.subgraphId) return
  if (!rootWorkflow.value?.definitions) return

  const innerWorkflow = enterSubgraph(
    node.data.subgraphId,
    node.data.subgraphName || node.data.title,
    JSON.parse(JSON.stringify(nodes.value)),
    JSON.parse(JSON.stringify(edges.value)),
    rootWorkflow.value.definitions,
  )
  if (!innerWorkflow) return

  // Render the inner subgraph workflow
  convertFromLiteGraph(innerWorkflow, rootWorkflow.value.definitions)
  nextTick(() => fitView({ padding: 0.2 }))
}

// Subgraph navigation: breadcrumb click to exit
function handleBreadcrumbNavigate(index: number) {
  if (!rootWorkflow.value?.definitions) return

  const restored = exitToLevel(
    index,
    JSON.parse(JSON.stringify(nodes.value)),
    JSON.parse(JSON.stringify(edges.value)),
    rootWorkflow.value.definitions,
    convertToLiteGraph,
  )
  if (!restored) return

  if (index === -1) {
    // Going back to root: re-convert from the root workflow (with updated definitions)
    convertFromLiteGraph(rootWorkflow.value, rootWorkflow.value.definitions)
  } else {
    // Restore the snapshotted state
    nodes.value = restored.nodes
    edges.value = restored.edges
  }
  nextTick(() => fitView({ padding: 0.2 }))
}

// Get workflow with subgraph awareness
function getWorkflowWithSubgraphs() {
  // If inside a subgraph, save current state back to definitions first
  if (isInsideSubgraph.value && rootWorkflow.value?.definitions) {
    saveCurrentSubgraph(
      nodes.value as any[],
      edges.value as any[],
      rootWorkflow.value.definitions,
      convertToLiteGraph,
    )
  }

  // Always return the root workflow with updated definitions
  if (rootWorkflow.value) {
    // If we're at root level, get the current state
    if (!isInsideSubgraph.value) {
      const wf = convertToLiteGraph()
      // Preserve definitions from root
      if (rootWorkflow.value.definitions) {
        ;(wf as any).definitions = rootWorkflow.value.definitions
      }
      return wf
    }
    // If inside a subgraph, return the root workflow (definitions already updated above)
    return rootWorkflow.value
  }

  return convertToLiteGraph()
}

// Listen for execution progress from bridge (via postMessage)
function handleBridgeMessage(event: MessageEvent) {
  if (event.data?.type !== 'comfynext-bridge') return

  const { event: evt, node_id, node, percent, progress: prog } = event.data
  const nodeId = node_id || node // bridge sends node_id, normalize
  if (evt === 'executing') {
    // Clear all running states on nodes and edges
    for (const n of nodes.value) {
      if (n.data?.running) {
        n.data = { ...n.data, running: false }
      }
    }
    for (const e of edges.value) {
      if (e.data?.running) {
        e.data = { ...e.data, running: false }
      }
    }
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        target.data = { ...target.data, running: true, error: false }
        // Light outgoing edges from this node — but only the ones whose
        // target is part of the current run set. A generator fanned out
        // to multiple sinks where only one is targeted should only
        // illuminate the active path. activeRunNodeIds is populated by
        // getFilteredWorkflow / getWorkflow at submission time.
        const activeSet = activeRunNodeIds.value
        for (const e of edges.value) {
          if (e.source !== String(nodeId)) continue
          // Empty active set = no filtering known (e.g. legacy run path);
          // light everything as before so we don't regress that case.
          if (activeSet.size && !activeSet.has(e.target)) continue
          e.data = { ...e.data, running: true }
        }
      }
    }
  }

  if (evt === 'progress') {
    // Update progress on the currently running node
    const running = (nodes.value as any[]).find((n: any) => n.data?.running)
    if (running) {
      // Bridge sends percent directly, or prog.value/prog.max
      const pct = percent ?? (prog ? Math.round((prog.value / prog.max) * 100) : undefined)
      if (pct !== undefined) running.data = { ...running.data, progress: pct }
    }
  }

  if (evt === 'executed') {
    // Store output images/videos/audio on the node (for PreviewImage, PreviewVideo, PreviewAudio, SaveImage etc.)
    const output = event.data.output
    if (nodeId && output) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        const toUrl = (f: any) => {
          const params = new URLSearchParams({ filename: f.filename, type: f.type })
          if (f.subfolder) params.set('subfolder', f.subfolder)
          // Cache-buster: live-preview nodes reuse a fixed filename, so without
          // a unique query the browser would serve the stale cached file.
          params.set('t', String(Date.now()))
          return `/view?${params}`
        }
        // Takes loop: append this run as a take instead of overwriting.
        // appendTake mirrors the new (active) take onto images/audios/text/
        // animated, so a single run stays behavior-identical while prior results
        // are preserved for compare/switch.
        const take = buildTake((event.data as any).prompt_id ?? null, output, toUrl)
        // Skip empties (a node that fires `executed` with a ui-only/empty
        // payload shouldn't pile up blank takes).
        if (takeHasContent(take)) target.data = appendTake({ ...target.data }, take)
      }
    }
  }

  if (evt === 'execution_error') {
    if (nodeId) {
      const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
      if (target) {
        // Persist the exception message on the node so the error stays
        // visible (red ring + inline chip) until the next successful run
        // on this node — toasts disappear, this doesn't.
        target.data = {
          ...target.data,
          running: false,
          error: true,
          errorMessage: event.data.exception_message || null,
        }
      }
    }
  }

  // On any successful executing event, clear stale error state for the node
  // that's about to run — the previous failure is no longer relevant.
  if (evt === 'executing' && nodeId) {
    const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
    if (target?.data?.error) {
      target.data = { ...target.data, error: false, errorMessage: null }
    }
  }

  if (evt === 'execution_complete') {
    // Clear all running/progress states on nodes and edges
    for (const n of nodes.value) {
      if (n.data?.running || n.data?.progress) {
        n.data = { ...n.data, running: false, progress: undefined }
      }
    }
    for (const e of edges.value) {
      if (e.data?.running) {
        e.data = { ...e.data, running: false }
      }
    }
    // Drop the captured run set — next Run captures fresh.
    activeRunNodeIds.value = new Set()
  }

  if (evt === 'gate_paused') {
    const promptId = event.data.prompt_id
    const target = (nodes.value as any[]).find((n: any) => n.id === String(nodeId))
    console.log('[Gate] gate_paused handler:', { nodeId, promptId, found: !!target })
    if (target) {
      target.data = { ...target.data, paused: true, promptId, running: false }
      console.log('[Gate] node data after update:', { paused: target.data.paused, promptId: target.data.promptId })
    }
  }

  if (evt === 'execution_start') {
    // Reset gate paused state but keep promptId so the user can
    // re-trigger from the gate after execution completes.
    const startPromptId = event.data.prompt_id
    for (const n of nodes.value) {
      if (n.data?.paused && (!startPromptId || n.data.promptId === startPromptId)) {
        n.data = { ...n.data, paused: false }
      }
    }
  }
}

// Compositor modal state.
const compositorOpenForId = ref<string | null>(null)
function handleOpenCompositor(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) compositorOpenForId.value = String(detail.nodeId)
}

// Kinetic Typography modal state.
const kineticTypeOpenForId = ref<string | null>(null)
function handleOpenKineticType(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) kineticTypeOpenForId.value = String(detail.nodeId)
}

// Images dropped onto a Frame become owned image layers (LocalLayer kind
// 'image') — uploaded, sized to their aspect, appended to the frame's layers.
// They flow through the same overlay bake/inject path as text & shapes.
async function handleFrameDropImage(e: Event) {
  const detail = (e as CustomEvent).detail
  const nodeId = detail?.nodeId
  const files: FileList | undefined = detail?.files
  if (!nodeId || !files?.length) return
  const node = (nodes.value as any[]).find(n => n.id === String(nodeId))
  if (!node) return
  if (!node.data.properties) node.data.properties = {}
  const existing: any[] = Array.isArray(node.data.properties.comfynext_localLayers)
    ? node.data.properties.comfynext_localLayers : []
  const added: any[] = []
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    try {
      const ts = Date.now()
      const safe = `frame_${ts}_${(file.name || 'image.png').replace(/[^\w.-]+/g, '_')}`
      const fd = new FormData()
      fd.append('image', new File([file], safe, { type: file.type }))
      fd.append('overwrite', 'true')
      const res = await fetch('/upload/image', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`upload ${res.status}`)
      const name = (await res.json())?.name || safe
      const aspect = await new Promise<number>((resolve) => {
        const im = new Image()
        im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1)
        im.onerror = () => resolve(1)
        im.src = `/view?${new URLSearchParams({ filename: name, type: 'input' })}`
      })
      added.push(createImageLayer(name, aspect))
    } catch (err) {
      console.error('[Frame] image drop failed:', err)
    }
  }
  if (added.length) node.data.properties.comfynext_localLayers = [...existing, ...added]
}

// ASCII options drawer state.
const asciiOpenForId = ref<string | null>(null)
function handleOpenAscii(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) asciiOpenForId.value = String(detail.nodeId)
}

// Timeline editor modal state.
const timelineOpenForId = ref<string | null>(null)
function handleOpenTimeline(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) timelineOpenForId.value = String(detail.nodeId)
}

// Crossfade editor modal state.
const crossfadeOpenForId = ref<string | null>(null)
function handleOpenCrossfade(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) crossfadeOpenForId.value = String(detail.nodeId)
}

// SmartLayout editor modal state — the visual layout editor that mounts over
// the canvas when the user clicks "Edit layout" on a SmartLayout node.
const smartLayoutOpenForId = ref<string | null>(null)
function handleOpenSmartLayout(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) smartLayoutOpenForId.value = String(detail.nodeId)
}

// Model gallery modal state — opened by the WidgetModelPicker launcher on
// generator nodes. Each gallery has its own open-state ref so two distinct
// modals (image vs video) don't share mount lifecycle; the dispatcher reads
// `detail.kind` and flips the right one.
const modelGalleryOpenForId = ref<string | null>(null)
const videoModelGalleryOpenForId = ref<string | null>(null)
const textEffectGalleryOpenForId = ref<string | null>(null)
const loraGalleryOpenForId = ref<string | null>(null)
function handleOpenModelGallery(e: Event) {
  const detail = (e as CustomEvent).detail
  const nodeId = detail?.nodeId ? String(detail.nodeId) : null
  if (!nodeId) return
  if (detail?.kind === 'video') videoModelGalleryOpenForId.value = nodeId
  else if (detail?.kind === 'text_effect') textEffectGalleryOpenForId.value = nodeId
  else modelGalleryOpenForId.value = nodeId
}
function handleOpenLoraGallery(e: Event) {
  const nodeId = (e as CustomEvent).detail?.nodeId
  if (nodeId) loraGalleryOpenForId.value = String(nodeId)
}

// Paste an image directly onto the canvas → uploads it to ComfyUI's input/
// folder and spawns a LoadImage node with the filename pre-filled. Supports
// clipboard image blobs (screenshots) and copied image files (from Finder/
// Explorer). Ignored when focus is in an editable element so Cmd+V in
// widget inputs still pastes text normally.
async function handlePaste(e: ClipboardEvent) {
  // Don't hijack paste when the user's typing in a widget/field. `e.target`
  // can be window (for synthetic dispatches) or non-Element nodes; guard
  // before calling Element methods on it.
  const t = e.target as Element | null
  const isEditableTarget =
    t instanceof Element
    && (t.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))
  if (isEditableTarget) return

  // Skip when the active element is editable (covers focused-but-untargeted
  // inputs, e.g. a focused textarea anywhere on the page).
  const ae = document.activeElement
  if (ae instanceof Element
    && (ae.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      || ae.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'))) {
    return
  }

  // Pull image from items (screenshots, copied images) or files (file drag).
  const items = Array.from(e.clipboardData?.items ?? [])
  let imageFile: File | null = null
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      imageFile = it.getAsFile()
      if (imageFile) break
    }
  }
  if (!imageFile && e.clipboardData?.files?.length) {
    const f = e.clipboardData.files[0]
    if (f.type.startsWith('image/')) imageFile = f
  }
  if (!imageFile) return

  e.preventDefault()

  // Upload to ComfyUI's input folder. Name is best-effort — screenshots arrive
  // as image.png; we prefix a timestamp so multiple pastes don't collide.
  const ts = Date.now()
  const safeName = (imageFile.name && imageFile.name !== 'image.png')
    ? imageFile.name
    : `pasted-${ts}.png`
  const renamed = new File([imageFile], `${ts}_${safeName.replace(/[^\w.-]+/g, '_')}`, {
    type: imageFile.type,
  })

  const fd = new FormData()
  fd.append('image', renamed)
  fd.append('overwrite', 'true')

  let uploadedName: string
  try {
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(await res.text() || `upload ${res.status}`)
    const data = await res.json()
    uploadedName = data?.name || renamed.name
  } catch (err: any) {
    console.error('[paste] upload failed:', err)
    return
  }

  // Refresh object_info so the LoadImage combo includes the just-uploaded
  // file. Cached by default; force a re-fetch.
  await fetchObjectInfo(true)

  // Spawn a LoadImage node centered in the viewport with the new filename.
  window.dispatchEvent(new CustomEvent('comfynext:addNode', {
    detail: {
      nodeType: 'LoadImage',
      widgetOverrides: { image: uploadedName },
    },
  }))
}

// Annotate-toolbar dispatcher: the floating toolbar fires `addAnnotation` and
// the canvas owns the spawn position and per-kind logic. We deliberately
// IGNORE the last-cursor position here — when the user clicks the toolbar
// their cursor is *at the toolbar* (bottom-center of the screen), which
// would spawn annotations directly under the toolbar button, where they're
// invisible. Always spawn at the visible center of the canvas instead, so
// every toolbar click produces a visible artifact.
function handleAddAnnotationEvent(event: Event) {
  const detail = (event as CustomEvent).detail
  const kind = detail?.kind
  if (!kind) return
  const screenCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const spawn = project(screenCenter)
  if (kind === 'sticky') createSticky({ x: spawn.x - 100, y: spawn.y - 100 })
  else if (kind === 'checklist') createChecklist({ x: spawn.x - 130, y: spawn.y - 110 })
  else if (kind === 'image') promptImagePin(spawn.x - 120, spawn.y - 120)
  else if (kind === 'arrow') {
    // One-shot: drop a default-length horizontal arrow centered on the viewport.
    // Two-click "draw arrow" mode is still available via the pane context
    // menu, keyboard A, or "Draw Arrow From Here…" on a group — that mode
    // matters for connecting specific things, but for the toolbar it's more
    // useful to just get a visible arrow you can right-click to edit/delete.
    const half = 120
    createArrow({
      from: { kind: 'point', x: spawn.x - half, y: spawn.y },
      to:   { kind: 'point', x: spawn.x + half, y: spawn.y },
    })
  }
}

onMounted(() => {
  window.addEventListener('comfynext:addNode', handleAddNode)
  window.addEventListener('comfynext:addAssetNode', handleAddAssetNode)
  window.addEventListener('comfynext:addAnnotation', handleAddAnnotationEvent)
  window.addEventListener('message', handleBridgeMessage)
  window.addEventListener('comfynext:openCompositor', handleOpenCompositor)
  window.addEventListener('comfynext:frameDropImage', handleFrameDropImage)
  window.addEventListener('comfynext:openAsciiOptions', handleOpenAscii)
  window.addEventListener('comfynext:openTimeline', handleOpenTimeline)
  window.addEventListener('comfynext:openCrossfade', handleOpenCrossfade)
  window.addEventListener('comfynext:openSmartLayout', handleOpenSmartLayout)
  window.addEventListener('comfynext:openModelGallery', handleOpenModelGallery)
  window.addEventListener('comfynext:openLoraGallery', handleOpenLoraGallery)
  window.addEventListener('comfynext:openKineticType', handleOpenKineticType)
  window.addEventListener('comfynext:edgeInsert', handleEdgeInsert)
  window.addEventListener('comfynext:applyEffect', handleApplyEffect)
  window.addEventListener('paste', handlePaste)
  window.addEventListener('keydown', handleHistoryKey)
  // Fetch object_info on mount so widget defs are available
  fetchObjectInfo()
})
onUnmounted(() => {
  window.removeEventListener('comfynext:addNode', handleAddNode)
  window.removeEventListener('comfynext:addAssetNode', handleAddAssetNode)
  window.removeEventListener('comfynext:addAnnotation', handleAddAnnotationEvent)
  window.removeEventListener('message', handleBridgeMessage)
  window.removeEventListener('comfynext:openCompositor', handleOpenCompositor)
  window.removeEventListener('comfynext:frameDropImage', handleFrameDropImage)
  window.removeEventListener('comfynext:openAsciiOptions', handleOpenAscii)
  window.removeEventListener('comfynext:openTimeline', handleOpenTimeline)
  window.removeEventListener('comfynext:openCrossfade', handleOpenCrossfade)
  window.removeEventListener('comfynext:openSmartLayout', handleOpenSmartLayout)
  window.removeEventListener('comfynext:openModelGallery', handleOpenModelGallery)
  window.removeEventListener('comfynext:openLoraGallery', handleOpenLoraGallery)
  window.removeEventListener('comfynext:openKineticType', handleOpenKineticType)
  window.removeEventListener('comfynext:edgeInsert', handleEdgeInsert)
  window.removeEventListener('comfynext:applyEffect', handleApplyEffect)
  window.removeEventListener('paste', handlePaste)
  window.removeEventListener('keydown', handleHistoryKey)
  // Revoke any held blob URLs from the client-side compositor previews.
  for (const url of compositorPreviewUrls.values()) URL.revokeObjectURL(url)
  compositorPreviewUrls.clear()
  // Same for Timeline previews; also tear down the hidden <video> elements.
  for (const url of timelinePreviewUrls.values()) URL.revokeObjectURL(url)
  timelinePreviewUrls.clear()
  for (const v of timelinePreviewVideos.values()) {
    try { v.pause(); v.removeAttribute('src'); v.load() } catch {}
  }
  timelinePreviewVideos.clear()
})

// ── Client-side Compositor preview ──────────────────────────────────────────
// The Compositor is just affine transforms + blend ops — we can render it
// instantly in the browser via Canvas instead of running the whole workflow.
// The result becomes the node's preview image via `data.images`.

const compositorPreviewUrls = new Map<string, string>()
const compositorRenderTokens = new Map<string, number>()
const compositorImageCache = new Map<string, HTMLImageElement>()
let compositorRendering = false
let compositorDirty = false
let compositorRafHandle = 0

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  soft_light: 'soft-light',
  hard_light: 'hard-light',
  difference: 'difference',
  lighten: 'lighten',
  darken: 'darken',
  add: 'lighter',
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = compositorImageCache.get(url)
  if (cached && cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { compositorImageCache.set(url, img); resolve(img) }
    img.onerror = reject
    img.src = url
  })
}

function getUpstreamImageUrl(srcNode: any): string | null {
  if (srcNode?.data?.images?.length) return srcNode.data.images[0]
  if (srcNode?.data?.nodeType === 'LoadImage' && srcNode?.data?.widgetsValues?.[0]) {
    const filename = srcNode.data.widgetsValues[0]
    return `/view?${new URLSearchParams({ filename, type: 'input' })}`
  }
  return null
}

function collectCompositorLayers(node: any): any[] {
  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  if (!defs || !wv) return []
  const widgetIdx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const out: any[] = []
  for (let i = 1; i <= 4; i++) {
    const port = node.data.inputs?.find((p: any) => p.name === `layer${i}`)
    if (!port?.link) continue
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${i - 1}`)
    if (!edge) continue
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    const url = getUpstreamImageUrl(src)
    if (!url) continue
    out.push({
      url,
      x: wv[widgetIdx(`layer${i}_x`)] ?? 0,
      y: wv[widgetIdx(`layer${i}_y`)] ?? 0,
      rotation: wv[widgetIdx(`layer${i}_rotation`)] ?? 0,
      scale: wv[widgetIdx(`layer${i}_scale`)] ?? 1,
      opacity: wv[widgetIdx(`layer${i}_opacity`)] ?? 1,
      blend: wv[widgetIdx(`layer${i}_blend`)] ?? 'normal',
    })
  }
  return out
}

async function renderComposite(layers: any[], frameDims: { w: number; h: number } | null = null): Promise<string> {
  const images = await Promise.all(layers.map(l => loadImage(l.url)))
  const maxDim = 512
  // Canvas aspect: explicit artboard dims win; else follow layer 1; else square.
  let aspect: number
  if (frameDims && frameDims.w > 0 && frameDims.h > 0) aspect = frameDims.w / frameDims.h
  else if (images[0]) aspect = images[0].naturalWidth / images[0].naturalHeight
  else aspect = 1
  let w: number, h: number
  if (aspect >= 1) { w = maxDim; h = Math.round(maxDim / aspect) }
  else            { h = maxDim; w = Math.round(maxDim * aspect) }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const img = images[i]
    // Aspect-preserving fit into canvas (matches backend `_fit_to_canvas`).
    const cAspect = w / h
    const iAspect = img.naturalWidth / img.naturalHeight
    let fitW: number, fitH: number
    if (iAspect > cAspect) { fitW = w; fitH = w / iAspect }
    else                   { fitH = h; fitW = h * iAspect }

    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.globalCompositeOperation = BLEND_MAP[layer.blend] || 'source-over'
    const cx = w / 2 + layer.x * w
    const cy = h / 2 + layer.y * h
    ctx.translate(cx, cy)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.scale(layer.scale, layer.scale)
    ctx.drawImage(img, -fitW / 2, -fitH / 2, fitW, fitH)
    ctx.restore()
  }

  // Local layers (text/shapes/images) are NOT baked here — the Frame renders
  // them as a live, interactive overlay on top of this wired composite, and the
  // submit path bakes them via `bakeOverlay`. This keeps `data.images` the
  // wired-only background so inline editing never double-draws.

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'))
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })
}

async function renderOneCompositor(node: any) {
  const layers = collectCompositorLayers(node)
  // Explicit artboard dims (width/height widgets), if set.
  const defs = node.data?.widgetDefs as any[] | undefined
  const wv = node.data?.widgetsValues as any[] | undefined
  const wi = defs?.findIndex((d: any) => d.name === 'width') ?? -1
  const hi = defs?.findIndex((d: any) => d.name === 'height') ?? -1
  const fw = wi >= 0 ? Number(wv?.[wi]) || 0 : 0
  const fh = hi >= 0 ? Number(wv?.[hi]) || 0 : 0
  const frameDims = (fw > 0 && fh > 0) ? { w: fw, h: fh } : null
  // Wired-only composite — locals are the Frame's live overlay.
  if (!layers.length) {
    const oldUrl = compositorPreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    compositorPreviewUrls.delete(node.id)
    if (node.data.images?.length) node.data = { ...node.data, images: [] }
    return
  }
  const token = (compositorRenderTokens.get(node.id) || 0) + 1
  compositorRenderTokens.set(node.id, token)
  try {
    const url = await renderComposite(layers, frameDims)
    if (compositorRenderTokens.get(node.id) !== token) {
      URL.revokeObjectURL(url)
      return
    }
    const oldUrl = compositorPreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    compositorPreviewUrls.set(node.id, url)
    node.data = { ...node.data, images: [url] }
  } catch (err) {
    console.warn('[Compositor preview] render failed:', err)
  }
}

// Build a reactive snapshot that includes upstream image identities so the
// watcher fires when LoadImage filenames change or when upstream nodes finish.
function compositorSnapshot(node: any) {
  const inputs = node.data.inputs as any[]
  const sources = inputs.map((port, idx) => {
    if (port?.link == null) return null
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${idx}`)
    if (!edge) return null
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    return src?.data?.images?.[0] ?? src?.data?.widgetsValues?.[0] ?? null
  })
  // Locals (text/shape/image) are NOT part of this snapshot: they don't affect
  // the wired-only `data.images`, and the Frame renders them live itself —
  // keeping them out avoids a wired re-render on every drag frame.
  return { id: node.id, widgets: [...(node.data.widgetsValues as any[])], inputs: inputs.map(i => i.link), sources }
}

// Coalesce renders to one per animation frame, with a dirty flag so changes
// during an in-flight render trigger another render immediately after.
// This keeps the preview updating live during a continuous drag — unlike a
// debounce, which would never fire as long as the drag keeps resetting it.
async function maybeRenderCompositors() {
  if (compositorRendering) { compositorDirty = true; return }
  compositorRendering = true
  compositorDirty = false
  try {
    const compositors = (nodes.value as any[]).filter(n => n.data?.nodeType === 'Compositor')
    await Promise.all(compositors.map(renderOneCompositor))
  } finally {
    compositorRendering = false
    if (compositorDirty) maybeRenderCompositors()
  }
}

// Vue's deep watch fires on every reactive change reached by the source,
// *including* our own writes to `node.data.images` — which would feedback-loop
// into another render. JSON-stringifying the snapshot makes Vue compare via
// `===`, so the watch only fires when something we actually care about changes.
watch(
  () => JSON.stringify(
    (nodes.value as any[]).filter(n => n.data?.nodeType === 'Compositor').map(compositorSnapshot)
  ),
  () => {
    if (compositorRafHandle) return
    compositorRafHandle = requestAnimationFrame(() => {
      compositorRafHandle = 0
      maybeRenderCompositors()
    })
  },
  { immediate: true },
)

// At submit time, realise each Frame's unified z-order stack into the backend
// graph. Wired image layers carry a `layer{N}_z` matching their stack depth;
// runs of local text/shape layers are baked into RGBA, uploaded, and injected
// into spare `layer{N}` slots (IMAGE + MASK) at the same depth — so a shape
// dragged *below* a wired image renders below it, matching the live preview.
// (The legacy always-on-top `overlay` input is left untouched; the backend
// still honours it for back-compat, but we no longer populate it.)
// Mutates `workflow` in place; called by the layout right before queueing.
async function injectCompositorOverlays(workflow: any): Promise<void> {
  if (!workflow?.nodes?.length) return
  const compositors = (workflow.nodes as any[]).filter(n => n.type === 'Compositor')
  for (const comp of compositors) {
    if ((comp.mode ?? 0) !== 0) continue // muted/bypassed won't execute
    const liveNode = (nodes.value as any[]).find(n => n.id === String(comp.id))
    if (!liveNode) continue
    if (!Array.isArray(comp.inputs)) comp.inputs = []

    const locals = (comp.properties?.comfynext_localLayers as LocalLayer[] | undefined) ?? []

    // Reconcile the saved stack order against what's actually present — the
    // exact reconciliation the Frame renders with. Keys: `w:<slot>` (0-based
    // connected image port) and `l:<id>` (local layer). Order is bottom→top.
    const connectedSlots: number[] = []
    for (let s = 0; s < 16; s++) {
      const port = comp.inputs.find((p: any) => p?.name === `layer${s + 1}`)
      if (port?.link != null) connectedSlots.push(s)
    }
    const presentKeys = [
      ...connectedSlots.map(s => `w:${s}`),
      ...locals.map(l => `l:${l.id}`),
    ]
    if (!presentKeys.length) continue
    const present = new Set(presentKeys)
    const saved = (comp.properties?.comfynext_stackOrder as string[] | undefined) ?? []
    const kept = saved.filter(k => present.has(k))
    const keptSet = new Set(kept)
    const order = [...kept, ...presentKeys.filter(k => !keptSet.has(k))]

    // Bake resolution mirrors the Frame's aspect: explicit artboard dims win,
    // else the lowest wired layer's native size, else a square default (a
    // locals-only frame with no preset). Only needed when there are locals.
    let W = 0, H = 0
    if (locals.length) {
      const defs = liveNode.data?.widgetDefs as any[] | undefined
      const wv = liveNode.data?.widgetsValues as any[] | undefined
      const wi = defs?.findIndex((d: any) => d.name === 'width') ?? -1
      const hi = defs?.findIndex((d: any) => d.name === 'height') ?? -1
      const fw = wi >= 0 ? Number(wv?.[wi]) || 0 : 0
      const fh = hi >= 0 ? Number(wv?.[hi]) || 0 : 0
      if (fw > 0 && fh > 0) {
        W = fw; H = fh
      } else {
        const imgLayers = collectCompositorLayers(liveNode)
        if (imgLayers.length) {
          try {
            const baseImg = await loadImage(imgLayers[0].url)
            W = baseImg.naturalWidth || 1024
            H = baseImg.naturalHeight || 1024
          } catch { /* fall through to square default */ }
        }
        if (!(W > 0 && H > 0)) { W = 1024; H = 1024 }
      }
      await ensureLayerFonts(locals, W)
      await ensureLayerImages(locals)
    }

    const localById = new Map(locals.map(l => [l.id, l] as [string, LocalLayer]))
    const usedSlots = new Set<number>(connectedSlots) // wired slots are taken

    // Bake one contiguous run of local layers into a spare slot at depth `z`.
    const injectRun = async (run: LocalLayer[], z: number) => {
      if (!run.length || !(W > 0 && H > 0)) return
      const blob = await bakeOverlay(run, W, H)
      if (!blob) return
      let slot = -1
      for (let s = 0; s < 16; s++) { if (!usedSlots.has(s)) { slot = s; break } }
      if (slot < 0) { console.warn('[compositor] no spare layer slot for local run'); return }
      usedSlots.add(slot)

      const file = new File([blob], `comfynext_local_${comp.id}_${slot}_${Date.now()}.png`, { type: 'image/png' })
      const fd = new FormData()
      fd.append('image', file)
      fd.append('overwrite', 'true')
      let name: string
      try {
        const res = await fetch('/upload/image', { method: 'POST', body: fd })
        if (!res.ok) throw new Error(await res.text() || `upload ${res.status}`)
        name = (await res.json())?.name || file.name
      } catch (err) {
        console.error('[compositor local] upload failed:', err)
        return
      }

      // Resolve / create the layer{N} image + layer{N}_mask ports.
      let imgIdx = comp.inputs.findIndex((p: any) => p?.name === `layer${slot + 1}`)
      if (imgIdx < 0) { comp.inputs.push({ name: `layer${slot + 1}`, type: 'IMAGE', link: null }); imgIdx = comp.inputs.length - 1 }
      let maskIdx = comp.inputs.findIndex((p: any) => p?.name === `layer${slot + 1}_mask`)
      if (maskIdx < 0) { comp.inputs.push({ name: `layer${slot + 1}_mask`, type: 'MASK', link: null }); maskIdx = comp.inputs.length - 1 }

      const loadId = (workflow.last_node_id || 0) + 1
      workflow.last_node_id = loadId
      const imgLink = (workflow.last_link_id || 0) + 1
      const maskLink = imgLink + 1
      workflow.last_link_id = maskLink

      workflow.nodes.push({
        id: loadId,
        type: 'LoadImage',
        pos: [(comp.pos?.[0] ?? 0) - 280, (comp.pos?.[1] ?? 0) + slot * 60],
        size: [220, 280],
        flags: {},
        mode: 0,
        inputs: [],
        outputs: [
          { name: 'IMAGE', type: 'IMAGE', links: [imgLink], slot_index: 0 },
          { name: 'MASK', type: 'MASK', links: [maskLink], slot_index: 1 },
        ],
        properties: {},
        widgets_values: [name, 'image'],
      })
      comp.inputs[imgIdx].link = imgLink
      comp.inputs[maskIdx].link = maskLink
      workflow.links.push([imgLink, loadId, 0, comp.id, imgIdx, 'IMAGE'])
      workflow.links.push([maskLink, loadId, 1, comp.id, maskIdx, 'MASK'])

      // Identity transform (the bake is already canvas-space) + this run's depth.
      setNamedWidget(comp, `layer${slot + 1}_x`, 0, objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_y`, 0, objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_rotation`, 0, objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_scale`, 1, objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_opacity`, 1, objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_blend`, 'normal', objectInfo.value)
      setNamedWidget(comp, `layer${slot + 1}_z`, z, objectInfo.value)
    }

    // Walk bottom→top: stamp each wired layer's z, accumulating contiguous local
    // runs and flushing them (at the run's bottom depth) when a wired layer or
    // the end interrupts the run. Stack index = z, so all depths are distinct.
    let run: LocalLayer[] = []
    let runZ = 0
    const flush = async () => { if (run.length) { await injectRun(run, runZ); run = [] } }
    for (let zi = 0; zi < order.length; zi++) {
      const key = order[zi]
      if (key.startsWith('w:')) {
        await flush()
        const slot = Number(key.slice(2))
        setNamedWidget(comp, `layer${slot + 1}_z`, zi, objectInfo.value)
      } else {
        const layer = localById.get(key.slice(2))
        if (layer) { if (!run.length) runZ = zi; run.push(layer) }
      }
    }
    await flush()
  }
}

// Turnkey "protect in blend": when a Compositor has any layer flagged protect
// AND feeds a Blend Scene whose keep_subject is unconnected, auto-wire the
// Compositor's `protect_mask` output into that keep_subject. Runs on the
// submitted workflow JSON, so the user never wires a mask by hand.
function injectProtectMaskWiring(workflow: any): void {
  if (!workflow?.nodes?.length) return
  if (!Array.isArray(workflow.links)) workflow.links = []
  const liveById = new Map((nodes.value as any[]).map(n => [String(n.id), n]))
  const compositors = (workflow.nodes as any[]).filter(n => n.type === 'Compositor')
  for (const comp of compositors) {
    if ((comp.mode ?? 0) !== 0) continue
    const live = liveById.get(String(comp.id))
    const defs = live?.data?.widgetDefs as any[] | undefined
    const wv = live?.data?.widgetsValues as any[] | undefined
    if (!defs || !wv) continue
    // Any layerN_protect widget truthy?
    const anyProtect = defs.some((d: any, i: number) =>
      /^layer\d+_protect$/.test(d?.name) && !!wv[i])
    if (!anyProtect) continue
    const outIdx = (comp.outputs as any[] | undefined)?.findIndex((o: any) => o?.name === 'protect_mask')
    if (outIdx == null || outIdx < 0) continue
    for (const node of workflow.nodes as any[]) {
      if (node.type !== 'BlendSceneNode' || (node.mode ?? 0) !== 0) continue
      // Only if this Blend Scene is actually fed by this Compositor.
      const fedByComp = (workflow.links as any[]).some(
        (l: any) => Array.isArray(l) && l[1] === comp.id && l[3] === node.id)
      if (!fedByComp) continue
      const ksIdx = (node.inputs as any[] | undefined)?.findIndex((inp: any) => inp?.name === 'keep_subject')
      if (ksIdx == null || ksIdx < 0) continue
      if (node.inputs[ksIdx].link != null) continue // user already wired one — respect it
      const linkId = (workflow.last_link_id || 0) + 1
      workflow.last_link_id = linkId
      workflow.links.push([linkId, comp.id, outIdx, node.id, ksIdx, 'MASK'])
      node.inputs[ksIdx].link = linkId
      if (!Array.isArray(comp.outputs[outIdx].links)) comp.outputs[outIdx].links = []
      comp.outputs[outIdx].links.push(linkId)
    }
  }
}

// Inject each Timeline node's editor state (tracks, clips, keyframes) into its
// hidden `edit_state` widget so the backend render matches the editor preview
// and FFmpeg export — keyframed transforms included. The editor already
// persists this JSON on the node (data.properties.edit_state); we just copy it
// into widgets_values at submit. No-op until the backend exposes the
// `edit_state` input in object_info (requires a ComfyUI restart after the
// schema change).
function injectTimelineEditState(workflow: any): void {
  if (!workflow?.nodes?.length) return
  const timelines = (workflow.nodes as any[]).filter(n => n.type === 'Timeline')
  for (const tl of timelines) {
    if ((tl.mode ?? 0) !== 0) continue // muted/bypassed won't execute
    const liveNode = (nodes.value as any[]).find(n => n.id === String(tl.id))
    const raw = liveNode?.data?.properties?.edit_state ?? tl.properties?.edit_state
    if (!raw) continue
    const json = typeof raw === 'string' ? raw : JSON.stringify(raw)
    setNamedWidget(tl, 'edit_state', json, objectInfo.value)
  }
}

// ── Client-side Timeline preview ────────────────────────────────────────────
// Mirrors the Compositor pattern but for video sources: each connected clip
// has a hidden <video>; we seek each one to the timeline's middle frame and
// composite them with the same transform/blend math the backend uses. The
// resulting still becomes the node-body preview via `data.images`.

const TIMELINE_FPS = 30
const timelinePreviewUrls = new Map<string, string>()
const timelinePreviewVideos = new Map<string, HTMLVideoElement>()  // keyed `${nodeId}-${slot}`
const timelineRenderTokens = new Map<string, number>()
let timelineRendering = false
let timelineDirty = false
let timelineRafHandle = 0

/** Resolve a Timeline clip port (slot = port_index, 1-based) to a still poster
 *  source. Uses the shared resolver but collapses KineticType to a single
 *  guaranteed-visible mid-sequence frame, and skips the generic images fallback
 *  so the baked poster never tries to render arbitrary upstream nodes. */
function getTimelineClipSource(node: any, slot: number): ClipSource | null {
  const edge = (edges.value as any[]).find((e: any) =>
    e.target === node.id && e.targetHandle === `input-${slot - 1}`)
  if (!edge) return null
  const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
  return resolveClipSource(src, { kinetic: 'mid', imagesFallback: false })
}

function collectTimelineLayers(node: any): any[] {
  // Prefer the editor's edit_state (workflow clips with real timing) — this is
  // where clips added via the Timeline editor live. Fall back to the legacy
  // flat clip{i}_* widgets for graphs wired without the editor.
  const rawState = node.data?.properties?.edit_state
  if (rawState) {
    try {
      const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
      if (state?.version === 1 && Array.isArray(state.tracks)) {
        const out: any[] = []
        for (const track of state.tracks) {
          if (track.muted || track.kind === 'audio') continue
          for (const clip of track.clips || []) {
            if (clip.kind !== 'workflow') continue
            const source = getTimelineClipSource(node, Number(clip.port_index ?? 0))
            if (!source) continue
            out.push({
              slot: clip.port_index, url: source.url, srcKind: source.kind,
              start: Number(clip.start_frame ?? 0), length: Number(clip.length ?? 30),
              x: Number(clip.x ?? 0), y: Number(clip.y ?? 0),
              rot: Number(clip.rotation ?? 0), scl: Number(clip.scale ?? 1),
              op: Number(clip.opacity ?? 1), blend: String(clip.blend ?? 'normal'),
              fadeIn: Number(clip.fade_in ?? 0), fadeOut: Number(clip.fade_out ?? 0),
            })
          }
        }
        if (out.length) return out
      }
    } catch { /* fall through to legacy */ }
  }

  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  if (!defs || !wv) return []
  const idx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const out: any[] = []
  for (let i = 1; i <= 4; i++) {
    const source = getTimelineClipSource(node, i)
    if (!source) continue
    out.push({
      slot: i, url: source.url, srcKind: source.kind,
      start:   Number(wv[idx(`clip${i}_start`)]    ?? 0),
      length:  Number(wv[idx(`clip${i}_length`)]   ?? 30),
      x:       Number(wv[idx(`clip${i}_x`)]        ?? 0),
      y:       Number(wv[idx(`clip${i}_y`)]        ?? 0),
      rot:     Number(wv[idx(`clip${i}_rotation`)] ?? 0),
      scl:     Number(wv[idx(`clip${i}_scale`)]    ?? 1),
      op:      Number(wv[idx(`clip${i}_opacity`)]  ?? 1),
      blend:   String(wv[idx(`clip${i}_blend`)]    ?? 'normal'),
      fadeIn:  Number(wv[idx(`clip${i}_fade_in`)]  ?? 0),
      fadeOut: Number(wv[idx(`clip${i}_fade_out`)] ?? 0),
    })
  }
  return out
}

/** Load an image source for the timeline preview (parallels loadVideoForPreview). */
function loadImageForPreview(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

function loadVideoForPreview(key: string, url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    let v = timelinePreviewVideos.get(key)
    const targetSrc = new URL(url, window.location.href).href
    if (v && v.src === targetSrc && v.readyState >= 2 && v.videoWidth > 0) {
      resolve(v); return
    }
    if (!v) {
      v = document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      timelinePreviewVideos.set(key, v)
    }
    const cleanup = () => {
      v!.removeEventListener('loadeddata', onLoaded)
      v!.removeEventListener('error', onError)
    }
    const onLoaded = () => { cleanup(); resolve(v!) }
    const onError = () => { cleanup(); reject(new Error('video load failed')) }
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('error', onError)
    if (v.src !== targetSrc) {
      v.src = url
      v.load()
    }
    // If already loaded enough, fire the resolve directly on next tick.
    if (v.readyState >= 2 && v.videoWidth > 0) {
      cleanup()
      resolve(v)
    }
  })
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const dur = v.duration
    if (!isFinite(dur) || dur <= 0) { resolve(); return }
    const target = Math.max(0, Math.min(dur, t))
    if (Math.abs(v.currentTime - target) < 0.05) { resolve(); return }
    let done = false
    const finish = () => { if (done) return; done = true; v.removeEventListener('seeked', finish); resolve() }
    v.addEventListener('seeked', finish)
    try { v.currentTime = target } catch { finish(); return }
    // Belt-and-suspenders: don't hang if seek doesn't fire.
    setTimeout(finish, 800)
  })
}

async function renderTimeline(node: any, layers: any[]): Promise<string | null> {
  const defs = node.data?.widgetDefs as any[]
  const wv = node.data?.widgetsValues as any[]
  const idx = (name: string) => defs.findIndex((d: any) => d.name === name)
  const explicit = Number(wv[idx('total_duration')] ?? 0)
  const total = explicit > 0
    ? explicit
    : layers.reduce((m, L) => Math.max(m, L.start + L.length), 1)
  const previewFrame = Math.floor(total / 2)
  const bgColor = String(wv[idx('bg_color')] ?? '#000000')

  // Load each layer's source — video (seeked to its local time) or image.
  const els: (HTMLVideoElement | HTMLImageElement | null)[] = await Promise.all(
    layers.map(async (L) => {
      try {
        if (L.srcKind === 'image') return await loadImageForPreview(L.url)
        const v = await loadVideoForPreview(`${node.id}-${L.slot}`, L.url)
        const inWindow = previewFrame >= L.start && previewFrame < L.start + L.length
        if (inWindow) {
          const localSec = (previewFrame - L.start) / TIMELINE_FPS
          const dur = v.duration
          if (isFinite(dur) && dur > 0) await seekVideo(v, ((localSec % dur) + dur) % dur)
        }
        return v
      } catch { return null }
    }),
  )

  const dimsOf = (el: HTMLVideoElement | HTMLImageElement | null): [number, number] => {
    if (!el) return [0, 0]
    if (el instanceof HTMLVideoElement) return [el.videoWidth, el.videoHeight]
    return [el.naturalWidth, el.naturalHeight]
  }

  // Canvas size from the first valid source, scaled down for thumbnail use.
  const ref = els.find(el => dimsOf(el)[0] > 0)
  if (!ref) return null
  const [rw, rh] = dimsOf(ref)
  const maxDim = 384
  const aspect = rw / rh
  const w = aspect >= 1 ? maxDim : Math.round(maxDim * aspect)
  const h = aspect >= 1 ? Math.round(maxDim / aspect) : maxDim

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < layers.length; i++) {
    const L = layers[i]!
    const el = els[i]
    const [sw, sh] = dimsOf(el)
    if (!el || sw === 0) continue
    if (previewFrame < L.start || previewFrame >= L.start + L.length) continue

    // Fade
    const localFrame = previewFrame - L.start
    let fadeAlpha = 1
    if (L.fadeIn > 0 && localFrame < L.fadeIn) fadeAlpha *= localFrame / L.fadeIn
    if (L.fadeOut > 0 && localFrame > L.length - L.fadeOut) {
      fadeAlpha *= (L.length - localFrame) / L.fadeOut
    }
    fadeAlpha = Math.max(0, Math.min(1, fadeAlpha))

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, L.op * fadeAlpha))
    ctx.globalCompositeOperation = BLEND_MAP[L.blend] || 'source-over'
    // Object-contain fit (matches backend `_fit_to_canvas`).
    const cAspect = w / h
    const vAspect = sw / sh
    let fitW: number, fitH: number
    if (vAspect > cAspect) { fitW = w; fitH = w / vAspect }
    else                   { fitH = h; fitW = h * vAspect }
    const cx = w / 2 + L.x * w
    const cy = h / 2 + L.y * h
    ctx.translate(cx, cy)
    ctx.rotate((L.rot * Math.PI) / 180)
    ctx.scale(L.scl, L.scl)
    try { ctx.drawImage(el, -fitW / 2, -fitH / 2, fitW, fitH) } catch {}
    ctx.restore()
  }

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob returned null'))
      resolve(URL.createObjectURL(blob))
    }, 'image/png')
  })
}

async function renderOneTimeline(node: any) {
  const layers = collectTimelineLayers(node)
  if (!layers.length) {
    const oldUrl = timelinePreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    timelinePreviewUrls.delete(node.id)
    if (node.data.images?.length) node.data = { ...node.data, images: [] }
    return
  }
  const token = (timelineRenderTokens.get(node.id) || 0) + 1
  timelineRenderTokens.set(node.id, token)
  try {
    const url = await renderTimeline(node, layers)
    if (url == null) return
    if (timelineRenderTokens.get(node.id) !== token) {
      URL.revokeObjectURL(url)
      return
    }
    const oldUrl = timelinePreviewUrls.get(node.id)
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    timelinePreviewUrls.set(node.id, url)
    node.data = { ...node.data, images: [url] }
  } catch (err) {
    console.warn('[Timeline preview] render failed:', err)
  }
}

function timelineSnapshot(node: any) {
  const inputs = node.data.inputs as any[]
  const sources = inputs.map((port, i) => {
    if (port?.link == null) return null
    const edge = (edges.value as any[]).find((e: any) =>
      e.target === node.id && e.targetHandle === `input-${i}`)
    if (!edge) return null
    const src = (nodes.value as any[]).find((n: any) => n.id === edge.source)
    // Track file widget value (filename) since that's what changes when the user picks a new clip.
    if (src?.data?.nodeType === 'LoadVideoFrames' || src?.data?.nodeType === 'LoadVideo') {
      const fileIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'file') ?? 0
      return src.data.widgetsValues?.[fileIdx >= 0 ? fileIdx : 0] ?? null
    }
    // KineticType (and similar) store rendered frames in params JSON — track
    // the rendered count + first filename so a re-bake invalidates the preview.
    if (src?.data?.nodeType === 'KineticType') {
      const pIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === 'params') ?? -1
      if (pIdx >= 0) {
        try {
          const p = JSON.parse(src.data.widgetsValues?.[pIdx] || '{}')
          const r = Array.isArray(p.rendered) ? p.rendered : []
          return `kt:${r.length}:${r[0] ?? ''}`
        } catch { /* ignore */ }
      }
    }
    // Universal artifact nodes: track the upload widget so picking a new file
    // invalidates the baked poster (falls back to images[0] post-run).
    if (src?.data?.nodeType === 'Video' || src?.data?.nodeType === 'Image') {
      const widgetName = src.data.nodeType === 'Video' ? 'file' : 'image'
      const wIdx = src.data.widgetDefs?.findIndex((d: any) => d.name === widgetName) ?? -1
      const fn = wIdx >= 0 ? src.data.widgetsValues?.[wIdx] : undefined
      return fn ?? src?.data?.images?.[0] ?? null
    }
    return src?.data?.images?.[0] ?? null
  })
  // Include edit_state so adding/moving clips in the editor triggers a refresh.
  const editState = node.data?.properties?.edit_state
  const editKey = typeof editState === 'string' ? editState : (editState ? JSON.stringify(editState) : '')
  return { id: node.id, widgets: [...(node.data.widgetsValues as any[])], inputs: inputs.map(i => i.link), sources, editKey }
}

async function maybeRenderTimelines() {
  if (timelineRendering) { timelineDirty = true; return }
  timelineRendering = true
  timelineDirty = false
  try {
    const tls = (nodes.value as any[]).filter(n => n.data?.nodeType === 'Timeline')
    await Promise.all(tls.map(renderOneTimeline))
  } finally {
    timelineRendering = false
    if (timelineDirty) maybeRenderTimelines()
  }
}

// Note: the static Timeline preview renderer is left in place but disabled —
// the Timeline node body uses TimelineNodePreview.vue (an embedded animated
// canvas) instead. Helpers above remain available if a future use needs a
// single-frame snapshot.

// Track whether any node is currently running (for background animation)
const isRunning = computed(() => (nodes.value as any[]).some((n: any) => n.data?.running))

// ---------------------------------------------------------------------------
// Context menu state + actions
// ---------------------------------------------------------------------------

interface MenuState { x: number; y: number; items: MenuItem[] }
const menu = ref<MenuState | null>(null)
function closeMenu() { menu.value = null }
function openMenu(x: number, y: number, items: MenuItem[]) { menu.value = { x, y, items } }

// Pending target ids for filtered run — emitted to the parent layout via a
// custom event so the existing runVueWorkflow plumbing can stay one path.
function emitRunFiltered(targetIds: string[]) {
  window.dispatchEvent(new CustomEvent('comfynext:runFiltered', { detail: { targetIds } }))
}
function emitRunAll() {
  window.dispatchEvent(new CustomEvent('comfynext:runAll'))
}

// Actions that operate on a set of node ids ---------------------------------

function setMode(nodeIds: string[], mode: number) {
  const set = new Set(nodeIds)
  for (const n of nodes.value as any[]) {
    if (set.has(n.id)) n.data = { ...n.data, mode }
  }
}
function toggleMode(nodeIds: string[], mode: number) {
  // If ANY selected node is already at this mode, clear all to 0. Otherwise
  // set all to the requested mode. Matches the "press Tab again to untoggle"
  // user expectation.
  const set = new Set(nodeIds)
  const anyAtMode = (nodes.value as any[]).some(n => set.has(n.id) && (n.data?.mode ?? 0) === mode)
  setMode(nodeIds, anyAtMode ? 0 : mode)
}

function duplicateNodes(nodeIds: string[]) {
  const set = new Set(nodeIds)
  const originals = (nodes.value as any[]).filter(n => set.has(n.id))
  const offset = 32
  for (const orig of originals) {
    const newId = String(Date.now() + Math.floor(Math.random() * 1000))
    nodes.value.push({
      ...orig,
      id: newId,
      position: { x: orig.position.x + offset, y: orig.position.y + offset },
      selected: false,
      data: JSON.parse(JSON.stringify(orig.data || {})),
    })
  }
}

function deleteNodes(nodeIds: string[]) {
  if (!nodeIds.length) return
  removeNodes(nodeIds)
}
function deleteEdges(edgeIds: string[]) {
  if (!edgeIds.length) return
  removeEdges(edgeIds)
}

// Group actions -------------------------------------------------------------

function actionGroupSelection() {
  const ids = getSelectedNodeIds()
  if (!ids.length) return
  createGroupFromSelection(ids)
}

function actionRunGroup(groupId: string) {
  const ids = nodesInGroup(groupId)
  if (!ids.length) return
  emitRunFiltered(ids)
}

function actionGroupModeAll(groupId: string, mode: number) {
  const ids = nodesInGroup(groupId)
  setMode(ids, mode)
}

// Block library — saves the group's contained nodes + internal links as a
// reusable template that can be dragged or clicked back onto any canvas.
const { saveBlock, getBlock } = useBlockLibrary()

/**
 * Insert a saved block at the given graph-space position. Strategy:
 *  1. Snapshot the current canvas into LG format.
 *  2. Assign fresh node IDs to the block's nodes (offset from last_node_id).
 *  3. Translate each block node's position by the drop point.
 *  4. Rebuild the block's internal links with fresh link IDs and the new
 *     node IDs.
 *  5. Add a new group encompassing the inserted nodes.
 *  6. Re-run convertFromLiteGraph against the merged snapshot.
 *
 * Re-running the conversion is destructive (replaces nodes.value / edges.value),
 * but the merged snapshot contains both the existing graph and the inserted
 * block — so the user's pre-existing nodes are preserved. Selection / drag
 * UI-state on existing nodes is cleared as a minor side effect; acceptable
 * for v1, and the history mechanism still lets undo work.
 */
function insertBlock(blockId: string, position: { x: number; y: number }) {
  const block = getBlock(blockId)
  if (!block) return

  const snapshot = convertToLiteGraph() as any
  const baseNodeId = Math.max(0, ...(snapshot.nodes || []).map((n: any) => Number(n.id))) + 1
  const baseLinkId = Math.max(0, ...(snapshot.links || []).map((l: any[]) => Number(l[0]))) + 1

  // old block-node-id → new fresh id
  const idMap = new Map<number, number>()
  block.nodes.forEach((n: any, i: number) => idMap.set(Number(n.id), baseNodeId + i))

  const insertedNodes = block.nodes.map((n: any) => {
    const newId = idMap.get(Number(n.id))!
    return {
      ...JSON.parse(JSON.stringify(n)), // deep clone so we don't mutate the stored block
      id: newId,
      pos: [n.pos[0] + position.x, n.pos[1] + position.y] as [number, number],
    }
  })

  const insertedLinks = (block.links || []).map((link: any[], i: number) => {
    if (!Array.isArray(link) || link.length < 6) return null
    const [, srcId, srcSlot, dstId, dstSlot, type] = link
    const newSrc = idMap.get(Number(srcId))
    const newDst = idMap.get(Number(dstId))
    if (newSrc == null || newDst == null) return null
    return [baseLinkId + i, newSrc, srcSlot, newDst, dstSlot, type]
  }).filter(Boolean)

  // Compute the group's new top-left from the inserted nodes (positions are
  // already absolute now). Width/height come from the stored block bounds.
  const groupOriginX = position.x
  const groupOriginY = position.y
  const newGroupRaw = {
    title: block.name,
    bounding: [groupOriginX, groupOriginY, block.bounds.width, block.bounds.height],
    color: block.color,
    font_size: 24,
  }

  const merged = {
    ...snapshot,
    nodes: [...(snapshot.nodes || []), ...insertedNodes],
    links: [...(snapshot.links || []), ...insertedLinks],
    groups: [...(snapshot.groups || []), newGroupRaw],
    last_node_id: baseNodeId + block.nodes.length - 1,
    last_link_id: baseLinkId + insertedLinks.length - 1,
  }

  convertFromLiteGraph(merged)
}

/** Drop-handler counterpart for block payloads (vs node-type strings). */
function tryHandleBlockDrop(event: DragEvent): boolean {
  const blockId = event.dataTransfer?.getData('application/x-comfynext-block')
  if (!blockId) return false
  const canvasEl = event.currentTarget as HTMLElement
  const rect = canvasEl.getBoundingClientRect()
  const dropPos = project({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  })
  insertBlock(blockId, dropPos)
  return true
}

/** Click-to-insert at viewport center. Listens for the panel's custom event. */
function handleInsertBlockEvent(e: Event) {
  const detail = (e as CustomEvent).detail
  const blockId = detail?.blockId as string | undefined
  if (!blockId) return
  // Convert the screen-space viewport center into graph-space.
  const canvasEl = document.querySelector('.vue-flow') as HTMLElement | null
  const rect = canvasEl?.getBoundingClientRect()
  const centerScreen = rect
    ? { x: rect.width / 2, y: rect.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const centerGraph = project(centerScreen)
  // Anchor the block's group at the center by offsetting half its bounds.
  const block = getBlock(blockId)
  if (!block) return
  insertBlock(blockId, {
    x: centerGraph.x - block.bounds.width / 2,
    y: centerGraph.y - block.bounds.height / 2,
  })
}
onMounted(() => window.addEventListener('comfynext:insertBlock', handleInsertBlockEvent))
onBeforeUnmount(() => window.removeEventListener('comfynext:insertBlock', handleInsertBlockEvent))

function actionSaveGroupAsBlock(groupId: string) {
  const group = groups.value.find(g => g.id === groupId)
  if (!group) return
  const memberIds = nodesInGroup(groupId)
  if (!memberIds.length) {
    if (typeof window !== 'undefined') window.alert('This group has no nodes to save.')
    return
  }
  const defaultName = group.title && group.title !== 'Group' ? group.title : ''
  const name = window.prompt('Save block as:', defaultName)
  if (!name || !name.trim()) return

  // Build a LiteGraph snapshot of just the group's contents.
  const wf = convertToLiteGraph()
  const memberIdSet = new Set(memberIds.map(Number))
  const blockNodes = (wf.nodes || []).filter((n: any) => memberIdSet.has(n.id))
  // Internal links only — drop anything that crosses the group boundary.
  const blockLinks = (wf.links || []).filter((link: any) => {
    if (!Array.isArray(link) || link.length < 4) return false
    return memberIdSet.has(Number(link[1])) && memberIdSet.has(Number(link[3]))
  })

  saveBlock({
    name: name.trim(),
    color: group.color,
    nodes: blockNodes,
    links: blockLinks,
    bounds: { width: group.width, height: group.height },
    // Subtract this origin from each node's position so the block stores
    // positions relative to the group's top-left corner.
    origin: { x: group.x, y: group.y },
  })
}

/**
 * Toggle a mode across every node in a group: if every node is already at
 * `mode`, reset them all to 0 (normal); otherwise set every node to `mode`.
 * Powers the title-bar bypass/mute icons.
 */
function actionToggleGroupMode(groupId: string, mode: number) {
  const ids = nodesInGroup(groupId)
  if (!ids.length) return
  const set = new Set(ids)
  const allAt = (nodes.value as any[]).filter(n => set.has(n.id)).every(n => (n.data?.mode ?? 0) === mode)
  setMode(ids, allAt ? 0 : mode)
}

/**
 * Returns 'all' if every contained node is at `mode`, 'mixed' if some are,
 * 'none' otherwise. Used to drive the toggle icons' active state.
 */
function groupModeState(groupId: string, mode: number): 'none' | 'mixed' | 'all' {
  const ids = nodesInGroup(groupId)
  if (!ids.length) return 'none'
  const set = new Set(ids)
  let on = 0
  for (const n of nodes.value as any[]) {
    if (set.has(n.id) && (n.data?.mode ?? 0) === mode) on++
  }
  if (on === 0) return 'none'
  if (on === ids.length) return 'all'
  return 'mixed'
}

function colorSubmenuItems(applyColor: (color: string) => void): MenuItem[] {
  return GROUP_COLORS.map(c => ({
    label: c,
    swatch: c,
    action: () => applyColor(c),
  }))
}

// Menu builders -------------------------------------------------------------

function paneMenuItems(x: number, y: number): MenuItem[] {
  // Convert click coords (screen space) to graph space so spawned annotations
  // land where the user clicked, not at viewport origin.
  const spawn = project({ x, y })
  return [
    { label: 'Run All', icon: Play, action: () => emitRunAll() },
    { divider: true },
    {
      label: 'Add Sticky Note',
      icon: StickyNote,
      action: () => createSticky({ x: spawn.x, y: spawn.y }),
      shortcut: 'S',
    },
    {
      label: 'Add Checklist',
      icon: ListChecks,
      action: () => createChecklist({ x: spawn.x, y: spawn.y }),
      shortcut: 'C',
    },
    {
      label: 'Add Image Pin…',
      icon: ImageIcon,
      action: () => promptImagePin(spawn.x, spawn.y),
    },
    {
      label: 'Add Arrow',
      icon: ArrowRight,
      action: () => beginArrowFromPoint(spawn.x, spawn.y),
      shortcut: 'A',
    },
    { divider: true },
    { label: 'Fit View', icon: Frame, action: () => fitView({ padding: 0.2 }) },
    { label: 'Select All', icon: SquareDashedMousePointer, action: () => {
      for (const n of nodes.value as any[]) n.selected = true
    } },
  ]
}

// Prompts the user for an image file, reads it as a data URL, then creates
// an image pin at the given graph-space coordinate.
function promptImagePin(x: number, y: number) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        createImagePin({ x, y, src: reader.result, caption: file.name })
      }
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function nodeMenuItems(nodeId: string): MenuItem[] {
  const node = (nodes.value as any[]).find(n => n.id === nodeId)
  const mode = node?.data?.mode ?? 0
  const items: MenuItem[] = [
    { label: 'Run from Selection', icon: Play, action: () => emitRunFiltered([nodeId]) },
    { divider: true },
    { label: mode === 4 ? 'Un-Bypass' : 'Bypass', icon: Ban, action: () => toggleMode([nodeId], 4) },
    { label: mode === 2 ? 'Un-Mute' : 'Mute', icon: EyeOff, action: () => toggleMode([nodeId], 2) },
    { divider: true },
  ]
  // For artifact image nodes that have a rendered image, offer pinning the
  // result to the canvas. The pin captures whatever metadata is visible on
  // the node at pin time — seed/prompt/model — by walking upstream.
  if (node?.type === 'artifact-image' && (node.data?.images?.[0] || node.data?.widgetsValues?.[0])) {
    items.push({
      label: 'Pin Result to Canvas',
      icon: ImageIcon,
      action: () => actionPinResultToCanvas(nodeId),
    })
    items.push({ divider: true })
  }
  items.push(
    { label: 'Duplicate', icon: Copy, action: () => duplicateNodes([nodeId]) },
    { label: 'Delete', icon: Trash2, danger: true, action: () => deleteNodes([nodeId]) },
  )
  return items
}

/**
 * Pin a generated image from an artifact-image node onto the canvas. Walks
 * upstream edges looking for a sampler-shaped node to capture seed/prompt/
 * model metadata. Falls back gracefully if the upstream isn't a recognized
 * generator — caption can be added by the user.
 */
function actionPinResultToCanvas(nodeId: string) {
  const node = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!node) return
  const src = node.data?.images?.[0]
    || (node.data?.widgetsValues?.[0]
      ? `/view?${new URLSearchParams({ filename: String(node.data.widgetsValues[0]), type: 'input' })}`
      : '')
  if (!src) return

  // Best-effort metadata harvest from immediate upstream nodes.
  const metadata: Record<string, any> = { sourceNodeId: nodeId }
  const upstream = (edges.value as any[]).filter(e => e.target === nodeId)
  for (const edge of upstream) {
    const srcNode = (nodes.value as any[]).find(n => n.id === edge.source)
    if (!srcNode) continue
    const t = srcNode.data?.nodeType || srcNode.type
    const w = srcNode.data?.widgetsValues || []
    if (/Sampler/i.test(t)) {
      // Comfy KSampler positions: seed, control, steps, cfg, sampler, scheduler, denoise
      if (typeof w[0] === 'number') metadata.seed = w[0]
      if (typeof w[2] === 'number') metadata.steps = w[2]
      if (typeof w[3] === 'number') metadata.cfg = w[3]
    } else if (/CheckpointLoader|UNETLoader/i.test(t)) {
      if (typeof w[0] === 'string') metadata.model = w[0]
    } else if (/CLIPTextEncode/i.test(t)) {
      // Prefer the first prompt found (positive is usually wired first).
      if (typeof w[0] === 'string' && !metadata.prompt) metadata.prompt = w[0]
    }
  }

  // Drop the pin to the right of the source node so it doesn't overlap.
  const spawnX = (node.position?.x ?? 0) + (node.dimensions?.width ?? 280) + 40
  const spawnY = (node.position?.y ?? 0)
  createResultPin({ x: spawnX, y: spawnY, src, metadata })
}

function selectionMenuItems(): MenuItem[] {
  const ids = getSelectedNodeIds()
  return [
    { label: `Run Selection (${ids.length})`, icon: Play, action: () => emitRunFiltered(ids) },
    { divider: true },
    { label: 'Group Selection', icon: Group, action: () => actionGroupSelection() },
    { divider: true },
    { label: 'Bypass', icon: Ban, action: () => toggleMode(ids, 4) },
    { label: 'Mute', icon: EyeOff, action: () => toggleMode(ids, 2) },
    { divider: true },
    { label: 'Duplicate', icon: Copy, action: () => duplicateNodes(ids) },
    { label: 'Delete', icon: Trash2, danger: true, action: () => deleteNodes(ids) },
  ]
}

function edgeMenuItems(edgeId: string): MenuItem[] {
  return [
    { label: 'Delete Edge', icon: Trash2, danger: true, action: () => deleteEdges([edgeId]) },
  ]
}

// Wrap dragGroup so annotations attached to the group travel with it.
// Splitting this out keeps the composable agnostic of annotations.
function onDragGroup(groupId: string, dx: number, dy: number) {
  dragGroup(groupId, dx, dy)
  dragGroupAttachedAnnotations(groupId, dx, dy)
}

// Wrap deleteGroup so the group's attached annotations don't outlive it
// as floating orphans.
const deleteGroupWithAnnotations = (groupId: string) => {
  removeAnnotationsForGroup(groupId)
  deleteGroup(groupId)
}

function statusSubmenuItems(groupId: string): MenuItem[] {
  // Tiny dot swatches communicate the chip color so the menu mirrors the chip.
  const opts: { value: CanvasGroup['status']; label: string; swatch: string }[] = [
    { value: null,       label: 'No status', swatch: 'transparent' },
    { value: 'wip',      label: 'WIP',       swatch: '#fbbf24' },
    { value: 'stable',   label: 'Stable',    swatch: '#4ade80' },
    { value: 'broken',   label: 'Broken',    swatch: '#f87171' },
    { value: 'archived', label: 'Archived',  swatch: '#94a3b8' },
  ]
  return opts.map(o => ({
    label: o.label,
    swatch: o.swatch,
    action: () => setGroupStatus(groupId, o.value),
  }))
}

function groupMenuItems(groupId: string): MenuItem[] {
  const g = groups.value.find(g => g.id === groupId)
  const collapsed = !!g?.collapsed
  const locked = !!g?.locked
  return [
    { label: 'Run Group', icon: Play, action: () => actionRunGroup(groupId) },
    { divider: true },
    {
      label: collapsed ? 'Expand Group' : 'Collapse Group',
      icon: collapsed ? ChevronsUpDown : ChevronsDownUp,
      action: () => toggleGroupCollapse(groupId),
    },
    {
      label: locked ? 'Unlock Group' : 'Lock Group',
      icon: locked ? Unlock : Lock,
      action: () => toggleGroupLock(groupId),
    },
    {
      label: 'Status',
      icon: Flag,
      children: statusSubmenuItems(groupId),
    },
    {
      label: 'Draw Arrow From Here…',
      icon: ArrowRight,
      action: () => beginArrowFromGroup(groupId),
    },
    { divider: true },
    { label: 'Bypass Group Nodes', icon: Ban, action: () => actionGroupModeAll(groupId, 4), disabled: locked },
    { label: 'Mute Group Nodes', icon: EyeOff, action: () => actionGroupModeAll(groupId, 2), disabled: locked },
    { label: 'Reset Group Nodes', icon: PlusSquare, action: () => actionGroupModeAll(groupId, 0), disabled: locked },
    { divider: true },
    { label: 'Save as Block…', icon: Boxes, action: () => actionSaveGroupAsBlock(groupId) },
    { divider: true },
    {
      label: 'Color',
      icon: Palette,
      children: colorSubmenuItems(c => updateGroup(groupId, { color: c })),
    },
    {
      label: 'Rename',
      icon: Edit3,
      action: () => {
        const newTitle = window.prompt('Group name', g?.title || 'Group')
        if (newTitle && newTitle.trim()) updateGroup(groupId, { title: newTitle.trim() })
      },
      disabled: locked,
    },
    { divider: true },
    { label: 'Delete Group', icon: Trash2, danger: true, action: () => deleteGroupWithAnnotations(groupId), disabled: locked },
  ]
}

// Event handlers ------------------------------------------------------------

function handlePaneContextMenu(event: MouseEvent) {
  event.preventDefault()
  openMenu(event.clientX, event.clientY, paneMenuItems(event.clientX, event.clientY))
}

function handleNodeContextMenu({ event, node }: { event: MouseEvent; node: any }) {
  event.preventDefault()
  event.stopPropagation()
  // If the right-clicked node is part of a multi-selection, show selection menu.
  const selectedIds = getSelectedNodeIds()
  const inSelection = selectedIds.length > 1 && selectedIds.includes(node.id)
  const items = inSelection ? selectionMenuItems() : nodeMenuItems(node.id)
  openMenu(event.clientX, event.clientY, items)
}

function handleEdgeContextMenu({ event, edge }: { event: MouseEvent; edge: any }) {
  event.preventDefault()
  event.stopPropagation()
  openMenu(event.clientX, event.clientY, edgeMenuItems(edge.id))
}

function handleSelectionContextMenu(payload: { event: MouseEvent; nodes: any[] } | MouseEvent) {
  // Vue Flow emits `{ event, nodes }`. Guard for either shape in case a
  // future version normalizes to MouseEvent directly.
  const event: MouseEvent = (payload as any)?.event ?? (payload as MouseEvent)
  event.preventDefault()
  event.stopPropagation()
  openMenu(event.clientX, event.clientY, selectionMenuItems())
}

function handleGroupContextMenu(groupId: string, x: number, y: number) {
  // If an arrow draw is in progress, prefer completing it on the group rather
  // than opening the context menu — the user's intent is clearly the arrow.
  if (pendingArrowFrom.value) {
    completePendingArrow({ kind: 'group', id: groupId })
    return
  }
  openMenu(x, y, groupMenuItems(groupId))
}

// Click on the empty canvas. Two responsibilities, in priority order:
//   1. If we're drawing an arrow, commit the `to` endpoint as a free point.
//   2. Otherwise, clear any active arrow selection (so the user can dismiss
//      the inline toolbar by clicking empty space).
function handlePaneClick(event: MouseEvent) {
  if (pendingArrowFrom.value) {
    const pos = project({ x: event.clientX, y: event.clientY })
    completePendingArrow({ kind: 'point', x: pos.x, y: pos.y })
    return
  }
  if (selectedArrowId.value) clearArrowSelection()
}

// Track cursor in graph space while an arrow is pending so the preview path
// follows the mouse. Wired via a window listener that's only active while
// drawing — keeps the mousemove cost zero when no arrow is in flight.
function trackPendingArrowCursor(event: MouseEvent) {
  if (!pendingArrowFrom.value) return
  const pos = project({ x: event.clientX, y: event.clientY })
  pendingArrowCursor.value = { x: pos.x, y: pos.y }
}
watch(pendingArrowFrom, (next, prev) => {
  if (next && !prev) window.addEventListener('mousemove', trackPendingArrowCursor)
  else if (!next && prev) window.removeEventListener('mousemove', trackPendingArrowCursor)
})

// Arrow context menu — small set: edit label, change color, delete.
function handleArrowContextMenu(arrowId: string, x: number, y: number) {
  const arrow = annotations.value.find(a => a.id === arrowId && a.kind === 'arrow') as
    Extract<typeof annotations.value[number], { kind: 'arrow' }> | undefined
  if (!arrow) return
  const ARROW_COLORS = ['#94a3b8', '#a78bfa', '#60a5fa', '#f472b6', '#fbbf24', '#4ade80']
  openMenu(x, y, [
    {
      label: 'Edit Label…',
      icon: Edit3,
      action: () => {
        const next = window.prompt('Arrow label', arrow.label || '')
        if (next !== null) updateAnnotation(arrowId, { label: next.trim() || undefined } as any)
      },
    },
    {
      label: 'Color',
      icon: Palette,
      children: ARROW_COLORS.map(c => ({
        label: c,
        swatch: c,
        action: () => updateAnnotation(arrowId, { color: c } as any),
      })),
    },
    { divider: true },
    { label: 'Delete Arrow', icon: Trash2, danger: true, action: () => removeAnnotation(arrowId) },
  ])
}

// Randomize every seed widget on the live canvas state before the workflow
// snapshot is taken. Seed widgets are detected the same way ComfyUI's bundled
// frontend detects them — INT inputs whose schema config carries
// `control_after_generate`. This is what `getWidgetDefs` already encodes.
// Mutating `nodes.value` (rather than the workflow JSON) means the user
// visibly sees the seed that's about to run, so they can pin one if they
// want by typing into the widget (the next Run randomizes again — locking
// is a follow-up).
// The set of node ids actually executing in the current run. Set by the
// getWorkflow / getFilteredWorkflow exposes right before submission, cleared
// on execution_complete. The executing-event handler uses this to decide
// which outgoing edges to illuminate — a generator fanned out to two sinks
// where only one is targeted should only light that path.
const activeRunNodeIds = ref<Set<string>>(new Set())

function captureActiveRunFromTargets(targetIds: string[]) {
  if (!targetIds.length) {
    // Global Run — every non-muted node is part of the active run.
    activeRunNodeIds.value = new Set(
      (nodes.value as any[])
        .filter((n: any) => (n.data?.mode ?? 0) !== 2)
        .map((n: any) => String(n.id)),
    )
    return
  }
  // Filtered Run — keep set is target ids + their transitive upstream deps.
  const wf = getWorkflowWithSubgraphs()
  if (!wf) { activeRunNodeIds.value = new Set(); return }
  const ids = targetIds.map(Number).filter(Number.isFinite)
  const keep = collectKeepSet(wf, ids)
  activeRunNodeIds.value = new Set([...keep].map(String))
}

function randomizeSeedsOnLiveState(onlyNodeIds?: Set<string>) {
  for (const node of nodes.value as any[]) {
    // Scoped re-roll: when a node-only run is requested, randomize seeds on the
    // target node(s) alone so every other node's inputs stay identical → ComfyUI
    // cache-hits all upstream (no regen, no re-billing) and only this node reruns.
    if (onlyNodeIds && !onlyNodeIds.has(node.id)) continue
    const defs = node.data?.widgetDefs as any[] | undefined
    const values = node.data?.widgetsValues as any[] | undefined
    if (!defs || !values) continue
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]
      if (!def || def.type !== 'INT') continue
      // Detect seed widgets uniformly: Comfy-standard ones carry the
      // control_after_generate flag; Replicate / custom-node seeds just have
      // "seed" in the name. We treat both as seed widgets.
      const isComfyStandard = !!def.control_after_generate
      const isSeed = isComfyStandard || /seed/i.test(String(def.name || ''))
      if (!isSeed) continue
      // Lock state lives in different slots depending on convention.
      const fixed = isComfyStandard
        ? values[i + 1] === 'fixed'
        : !!node.data?.properties?.seedLocks?.[def.name]
      if (fixed) continue
      const max = Math.min(Number(def.max) || 2 ** 53 - 1, 2 ** 53 - 1)
      values[i] = Math.floor(Math.random() * max)
    }
  }
}

// Build a filtered workflow snapshot from current canvas + target ids. Used
// by the layout when it receives the runFiltered event.
function getFilteredWorkflow(targetIds: string[], opts: { rerollScope?: 'self' } = {}) {
  // 'self' = re-roll only the target node's seed (keep upstream cached); default
  // = re-roll every seed in the graph (the classic full-run behavior).
  randomizeSeedsOnLiveState(opts.rerollScope === 'self' ? new Set(targetIds) : undefined)
  captureActiveRunFromTargets(targetIds)
  const wf = getWorkflowWithSubgraphs()
  if (!wf) return wf
  // Realign widget values against the current schema FIRST — workflows
  // saved against an older schema may have shifted positional slots,
  // which would land e.g. camera_fixed's `false` in resolution's combo
  // slot and break validation. Everything downstream assumes aligned data.
  const aligned = realignWidgetValues(wf, objectInfo.value)
  // Then locks drop upstream links so collectKeepSet walks a graph where
  // locked artifacts look like leaves.
  const unlocked = applyArtifactLocks(aligned, nodes.value as any[])
  const filtered = targetIds.length ? buildFilteredWorkflow(unlocked, targetIds) : unlocked
  // A standalone artifact card that's *showing* a result (but has nothing wired
  // in) feeds the shown image instead of a black placeholder.
  const backfilled = backfillStandaloneArtifactImages(filtered, nodes.value as any[], objectInfo.value)
  const withFanOut = applyVariantFanOut(backfilled, objectInfo.value)
  forceExportOnCapturedArtifacts(withFanOut)
  return withFanOut
}

// An image/audio/video artifact that's capturing a wired upstream result is,
// by definition, displaying a generation the user wants to keep — so force its
// `export` on at submission. This writes a permanent file to output/ (which the
// Assets page surfaces via its disk listing) instead of only an ephemeral temp
// preview. Stale persisted sinks (saved with export=false) are corrected here
// too. A bare artifact loading from disk (no upstream link) keeps the user's
// own export choice untouched.
const EXPORTABLE_ARTIFACT_TYPES = new Set(['Image', 'Audio', 'Video'])
function forceExportOnCapturedArtifacts(wf: any) {
  if (!wf?.nodes) return
  for (const node of wf.nodes) {
    if (!EXPORTABLE_ARTIFACT_TYPES.has(node.type)) continue
    const hasUpstream = (node.inputs || []).some((i: any) => i?.link != null)
    if (!hasUpstream) continue
    const defs = getWidgetDefs(node.type)
    const ei = defs.findIndex((w: any) => w.name === 'export')
    if (ei < 0) continue
    if (!Array.isArray(node.widgets_values)) {
      node.widgets_values = defs.map((w: any) => w.default ?? null)
    }
    node.widgets_values[ei] = true
  }
}

// One-time-per-session schema refresh, then heal any drifted Compositor nodes.
// The frontend fetches /object_info once at mount; if that happened before the
// backend finished registering the Compositor's Phase-B inputs (per-layer z +
// mask), the cached schema is stale — z-injection silently no-ops (setNamedWidget
// can't find layerN_z, so the unified stack order never reaches the backend) and
// realign aligns arrays to the wrong width. Force one fresh fetch before the
// first run, then realign every live Compositor against the real schema.
let schemaForcedOnce = false
async function refreshSchema() {
  if (!schemaForcedOnce) {
    schemaForcedOnce = true
    await fetchObjectInfo(true)
  }
  healCompositorNodes()
}

// Realign each live Compositor's widgetDefs + widgets_values to the current
// schema, in place, so the editor, overlay injection, and submit all read the
// same aligned data. Reuses realignWidgetValues, which pads length drift and
// resets a provably-scrambled array (a number in a blend combo) to defaults.
function healCompositorNodes() {
  const freshDefs = getWidgetDefs('Compositor')
  if (!freshDefs.length) return
  for (const n of nodes.value as any[]) {
    if (n.data?.nodeType !== 'Compositor') continue
    const cur = Array.isArray(n.data.widgetsValues) ? [...n.data.widgetsValues] : []
    const mini = { nodes: [{ id: 1, type: 'Compositor', widgets_values: cur }], links: [] }
    const out = realignWidgetValues(mini as any, objectInfo.value)
    n.data = { ...n.data, widgetDefs: freshDefs, widgetsValues: out.nodes[0].widgets_values }
  }
}

// When the user runs a node that has dangling outputs of an artifact-bearing
// type (IMAGE / AUDIO / VIDEO / STRING), drop a fresh artifact card to its
// right and wire the output to it. The card receives the execution result and
// renders the preview — no need to know that PreviewImage/PreviewAudio/etc.
// exist. Returns the original target list plus the new sink ids so the run
// includes them.
function materializeAutoImageSinks(targetIds: string[]): string[] {
  if (!targetIds.length) return targetIds

  // Build a schema snapshot for each artifact node type we know about, lazily.
  // Skips types whose Comfy node hasn't been reported yet (e.g. a fresh Comfy
  // install that doesn't have the new Audio node loaded).
  const schemas: Record<string, {
    inputs: any[]; outputs: any[]; widgetDefs: any[]; info: any; primaryInputIdx: number;
  }> = {}
  function getSchema(nodeType: string) {
    if (schemas[nodeType]) return schemas[nodeType]
    const info = objectInfo.value[nodeType]
    if (!info) return null
    const widgetDefs = getWidgetDefs(nodeType)
    const inputs = [
      ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
      ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
    ]
      .filter(({ s }) => {
        // Same port/widget split as the regular add-node path.
        const specArr = Array.isArray(s) ? s : [s]
        const type = specArr[0]
        const cfg = specArr[1] || {}
        if (Array.isArray(type)) return false
        if (cfg.forceInput) return true
        return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(type))
      })
      .map(({ n, s, optional }) => ({
        name: n,
        type: Array.isArray(s) ? String(s[0]) : String(s),
        link: null,
        optional,
      }))
    const outputs = (info?.output || []).map((type: string, i: number) => ({
      name: info?.output_name?.[i] || type,
      type,
      links: null,
    }))
    // The "primary" input is the optional pass-through port matching the
    // artifact's medium — that's where the auto-wired upstream connects.
    // Currently every artifact node has exactly one non-widget input; pick
    // the first port and we're good.
    const primaryInputIdx = inputs.length > 0 ? 0 : -1
    if (primaryInputIdx < 0) return null
    schemas[nodeType] = { inputs, outputs, widgetDefs, info, primaryInputIdx }
    return schemas[nodeType]
  }

  const additional: string[] = []
  // Snapshot the current nodes so we don't iterate over ones we just added.
  const snapshot = [...(nodes.value as any[])]
  // Numeric IDs only — the workflow-to-Comfy conversion parseInts the string
  // id, so anything past a non-digit gets dropped and the executed-event echo
  // back from Comfy won't match the Vue Flow node. Each new sink offsets from
  // Date.now() to stay unique within this call.
  let idSeed = Date.now()
  // Skip nodes that are already artifact cards — they ARE the artifact.
  const artifactNodeTypes = new Set(Object.keys(ARTIFACT_NODE_COMPONENTS))

  for (const id of targetIds) {
    const src = snapshot.find((n: any) => n.id === id)
    if (!src) continue
    if (artifactNodeTypes.has(src.data?.nodeType)) continue

    const outputs = (src.data?.outputs ?? []) as Array<{ name: string; type: string }>
    const srcW = (src.data?.size?.[0] ?? 220) as number
    const srcPos = src.position || { x: 0, y: 0 }

    let stacked = 0
    for (let i = 0; i < outputs.length; i++) {
      const outType = String(outputs[i].type).toUpperCase()
      const artifactNodeType = ARTIFACT_NODE_FOR_OUTPUT[outType]
      if (!artifactNodeType) continue
      const schema = getSchema(artifactNodeType)
      if (!schema) continue
      // Skip if anything is already wired from this exact output handle.
      const handle = `output-${i}`
      const alreadyWired = (edges.value as any[]).some((e) => e.source === id && e.sourceHandle === handle)
      if (alreadyWired) continue

      const newId = String(idSeed++)
      // Slot multi-output cases vertically so they don't overlap.
      const position = { x: srcPos.x + srcW + 80, y: srcPos.y + stacked * 320 }
      stacked++

      nodes.value.push({
        id: newId,
        type: getVueFlowType(artifactNodeType),
        position,
        data: {
          nodeType: artifactNodeType,
          title: schema.info?.display_name || artifactNodeType,
          inputs: schema.inputs.map((p) => ({ ...p })),
          outputs: schema.outputs.map((p: any) => ({ ...p })),
          // Default widgets, but force `export` on: an auto-created sink should
          // SAVE the generated result to output/ so it appears in Assets and
          // survives as a real file (not just an ephemeral temp preview).
          widgetsValues: (() => {
            const wv = schema.widgetDefs.map((w: any) => w.default ?? null)
            const ei = schema.widgetDefs.findIndex((w: any) => w.name === 'export')
            if (ei >= 0) wv[ei] = true
            return wv
          })(),
          widgetDefs: schema.widgetDefs,
          properties: {},
          mode: 0,
          size: [240, 280],
          category: schema.info?.category || '',
          outputNode: !!schema.info?.output_node,
          priceBadge: schema.info?.price_badge || null,
        },
      } as any)

      // Push the edge synchronously so the workflow-conversion in the very
      // next tick sees the link. Vue Flow renders the SVG path on its own
      // schedule — what matters here is that `edges.value` reflects the
      // wire when `getFilteredWorkflow` reads it.
      edges.value.push({
        id: `e-auto-${newId}`,
        source: id,
        sourceHandle: handle,
        target: newId,
        targetHandle: `input-${schema.primaryInputIdx}`,
        type: 'comfy',
        data: { dataType: outType },
      } as any)

      additional.push(newId)
    }
  }

  // Also expand targets to include EXISTING wired artifact sinks downstream
  // of each target. Without this, clicking Run on a generator that's already
  // wired to a sink runs the generator but never invites its sink into the
  // keep set — so the sink's preview never fires. With this, the gesture
  // means "run this AND show me the result", which is what users expect.
  const downstream: string[] = []
  for (const id of [...targetIds, ...additional]) {
    for (const e of edges.value as any[]) {
      if (String(e.source) !== id) continue
      const targetNode = (nodes.value as any[]).find((n: any) => n.id === e.target)
      if (!targetNode) continue
      if (!artifactNodeTypes.has(targetNode.data?.nodeType)) continue
      if (downstream.includes(targetNode.id)) continue
      if (targetIds.includes(targetNode.id)) continue
      downstream.push(targetNode.id)
    }
  }

  const expanded = [...targetIds, ...additional, ...downstream]
  return expanded.length === targetIds.length ? targetIds : expanded
}

/**
 * Drop a "start graph" onto an empty canvas — used by the Get Started modal
 * after the user picks a (from, to, model) combo. When `sourceNodeType` is
 * given, a matching artifact card lands to the left of the generator and is
 * wired into it via the first input port whose type matches the source's
 * primary output. Otherwise just the generator is placed (prompt-only path).
 *
 * Positions are absolute canvas coords — fitView at the end frames whatever
 * we just dropped, so the user doesn't have to zoom around.
 */
function materializeStartGraph(opts: { sourceNodeType?: string; generatorNodeType: string }) {
  const genInfo = objectInfo.value[opts.generatorNodeType]
  if (!genInfo) return

  const buildNodeData = (nodeType: string) => {
    const info = objectInfo.value[nodeType]
    if (!info) return null
    const widgetDefs = getWidgetDefs(nodeType)
    const inputs = [
      ...Object.entries((info?.input?.required ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: false })),
      ...Object.entries((info?.input?.optional ?? {}) as Record<string, any>).map(([n, s]) => ({ n, s, optional: true })),
    ]
      .filter(({ s }) => {
        const specArr = Array.isArray(s) ? s : [s]
        const type = specArr[0]
        const cfg = specArr[1] || {}
        if (Array.isArray(type)) return false
        if (cfg.forceInput) return true
        return !['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(String(type))
      })
      .map(({ n, s, optional }) => ({
        name: n,
        type: Array.isArray(s) ? String(s[0]) : String(s),
        link: null,
        optional,
      }))
    const outputs = (info?.output || []).map((type: string, i: number) => ({
      name: info?.output_name?.[i] || type,
      type,
      links: null,
    }))
    return {
      info, widgetDefs, inputs, outputs,
    }
  }

  let idSeed = Date.now()
  const sourceId = opts.sourceNodeType ? String(idSeed++) : null
  const generatorId = String(idSeed++)

  const sourceData = opts.sourceNodeType ? buildNodeData(opts.sourceNodeType) : null
  const generatorData = buildNodeData(opts.generatorNodeType)
  if (!generatorData) return

  // Pick canvas-coord positions. Left source, right generator. If no source,
  // generator sits roughly centered.
  const sourceX = 80
  const generatorX = sourceId ? 420 : 200

  if (sourceId && sourceData) {
    nodes.value.push({
      id: sourceId,
      type: getVueFlowType(opts.sourceNodeType!),
      position: { x: sourceX, y: 80 },
      data: {
        nodeType: opts.sourceNodeType,
        title: sourceData.info?.display_name || opts.sourceNodeType,
        inputs: sourceData.inputs,
        outputs: sourceData.outputs,
        widgetsValues: sourceData.widgetDefs.map((w: any) => w.default ?? null),
        widgetDefs: sourceData.widgetDefs,
        properties: {},
        mode: 0,
        size: [240, 280],
        category: sourceData.info?.category || '',
        outputNode: !!sourceData.info?.output_node,
      },
    } as any)
  }

  nodes.value.push({
    id: generatorId,
    type: getVueFlowType(opts.generatorNodeType),
    position: { x: generatorX, y: 80 },
    data: {
      nodeType: opts.generatorNodeType,
      title: generatorData.info?.display_name || opts.generatorNodeType,
      inputs: generatorData.inputs,
      outputs: generatorData.outputs,
      widgetsValues: generatorData.widgetDefs.map((w: any) => w.default ?? null),
      widgetDefs: generatorData.widgetDefs,
      properties: {},
      mode: 0,
      size: [220, 120],
      category: generatorData.info?.category || '',
      outputNode: !!generatorData.info?.output_node,
      priceBadge: generatorData.info?.price_badge || null,
    },
  } as any)

  // Wire source → generator on the first matching type pair (e.g. source IMAGE
  // output to generator's first IMAGE input).
  if (sourceId && sourceData) {
    const srcPrimary = sourceData.outputs.findIndex(
      (o: any) => /^(IMAGE|AUDIO|VIDEO|STRING)$/i.test(String(o.type)),
    )
    if (srcPrimary >= 0) {
      const srcType = String(sourceData.outputs[srcPrimary].type).toUpperCase()
      const genInputIdx = generatorData.inputs.findIndex(
        (i: any) => String(i.type).toUpperCase() === srcType,
      )
      if (genInputIdx >= 0) {
        edges.value.push({
          id: `e-start-${generatorId}`,
          source: sourceId,
          sourceHandle: `output-${srcPrimary}`,
          target: generatorId,
          targetHandle: `input-${genInputIdx}`,
          type: 'comfy',
          data: { dataType: srcType },
        } as any)
      }
    }
  }

  // Frame what we just dropped.
  nextTick(() => fitView({ padding: 0.3 }))
}

// Expose methods and state for parent layout
defineExpose({
  materializeStartGraph,
  // Global Run path. Match the per-node Run pre-processing: realign widget
  // values, randomize seeds on the live canvas state, capture the active run
  // set, apply locks, then variant fan-out on the JSON snapshot.
  getWorkflow: () => {
    randomizeSeedsOnLiveState()
    captureActiveRunFromTargets([])
    const wf = getWorkflowWithSubgraphs()
    if (!wf) return wf
    const aligned = realignWidgetValues(wf, objectInfo.value)
    const unlocked = applyArtifactLocks(aligned, nodes.value as any[])
    const backfilled = backfillStandaloneArtifactImages(unlocked, nodes.value as any[], objectInfo.value)
    return applyVariantFanOut(backfilled, objectInfo.value)
  },
  getFilteredWorkflow,
  refreshSchema,
  injectCompositorOverlays,
  injectProtectMaskWiring,
  injectTimelineEditState,
  materializeAutoImageSinks,
  getNodes: () => nodes.value,
  getEdges: () => edges.value,
  getObjectInfo: () => objectInfo.value,
  zoomIn: () => vfZoomIn(),
  zoomOut: () => vfZoomOut(),
  fitView: () => fitView({ padding: 0.2 }),
})
</script>

<template>
  <!-- tabindex="-1" makes the canvas root programmatically focusable. After
       a Run, the layout calls `.focus()` here to pull focus out of the
       hidden bridge iframe (which, on macOS, can otherwise capture pinch-
       zoom gestures for itself). focus:outline-none keeps the focus ring
       invisible; we only need the focus state for event routing, not UI. -->
  <div
    class="vue-node-canvas-root w-full h-full relative bg-[#0a0a0a] focus:outline-none"
    tabindex="-1"
    @dragover.prevent
    @contextmenu.prevent
  >
    <!-- Dot grid behind everything -->
    <VueCanvasAnimatedDotGrid :running="isRunning" />

    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="{ comfy: markRaw(ComfyNode), note: markRaw(ComfyNoteNode), gate: markRaw(ComfyGateNode), 'artifact-image': markRaw(ArtifactImageNode), 'artifact-text': markRaw(ArtifactTextNode), 'artifact-audio': markRaw(ArtifactAudioNode), 'artifact-video': markRaw(ArtifactVideoNode), 'artifact-frame': markRaw(ArtifactFrameNode), 'artifact-timeline': markRaw(ArtifactTimelineNode), 'subgraph-io': markRaw(SubgraphIONode) }"
      :edge-types="{ comfy: markRaw(ComfyEdge) }"
      :default-edge-options="{ type: 'comfy' }"
      :pan-on-drag="panOnDrag"
      :selection-key-code="selectionKeyCode"
      pan-on-scroll
      :zoom-on-pinch="true"
      :zoom-on-scroll="true"
      :prevent-scrolling="true"
      :snap-to-grid="true"
      :snap-grid="[16, 16]"
      :min-zoom="0.1"
      :max-zoom="4"
      :connection-line-style="{ stroke: '#818cf8', strokeWidth: 2 }"
      :delete-key-code="['Backspace', 'Delete']"
      class="vue-node-canvas"
      fit-view-on-init
      @drop="handleDrop"
      @dragover="handleCanvasDragOver"
      @dragleave="dragOverEdgeId = null"
      @node-double-click="handleNodeDoubleClick"
      @pane-context-menu="handlePaneContextMenu"
      @node-context-menu="handleNodeContextMenu"
      @edge-context-menu="handleEdgeContextMenu"
      @selection-context-menu="handleSelectionContextMenu"
      @pane-click="handlePaneClick"
    >
      <MiniMap
        class="!bg-[#1a1a1a] !border-[#2a2a2a] comfy-minimap"
        :node-color="() => '#2a2a2a'"
        :mask-color="'rgba(0, 0, 0, 0.6)'"
      />
    </VueFlow>

    <!-- Group layer: lives outside VueFlow, in screen space, but applies a
         CSS transform that mirrors VueFlow's viewport so its children
         effectively render in graph space. Z-index sits between the dot
         grid (behind) and the VueFlow node layer (in front). -->
    <div
      class="canvas-groups-layer absolute inset-0 overflow-hidden pointer-events-none"
      style="z-index: 1"
    >
      <div
        class="absolute top-0 left-0"
        :style="{
          transform: `translate(${vfViewport.x}px, ${vfViewport.y}px) scale(${vfViewport.zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <CanvasGroupView
          v-for="g in groups"
          :key="g.id"
          :group="g"
          :bypass-state="groupModeState(g.id, 4)"
          :mute-state="groupModeState(g.id, 2)"
          :member-count="groupMemberCounts[g.id]"
          class="pointer-events-auto"
          @drag="(id, dx, dy) => onDragGroup(id, dx, dy)"
          @resize="(id, w, h) => resizeGroup(id, w, h)"
          @title-edit="(id, t) => updateGroup(id, { title: t })"
          @context-menu="handleGroupContextMenu"
          @run="actionRunGroup"
          @toggle-bypass="(id) => actionToggleGroupMode(id, 4)"
          @toggle-mute="(id) => actionToggleGroupMode(id, 2)"
          @save-as-block="actionSaveGroupAsBlock"
          @toggle-collapse="(id) => toggleGroupCollapse(id)"
          @toggle-lock="(id) => toggleGroupLock(id)"
        />
      </div>
    </div>

    <!-- Annotations layer: stickies, checklists, pins, arrows. Sits ABOVE the
         groups layer (so a sticky pinned to a group reads as "on top of" it)
         but BELOW Vue Flow's node layer (so nodes always win for click priority
         on the executable graph). Same viewport-transform trick as groups. -->
    <div
      class="canvas-annotations-layer absolute inset-0 overflow-hidden pointer-events-none"
      style="z-index: 2"
    >
      <div
        class="absolute top-0 left-0"
        :style="{
          transform: `translate(${vfViewport.x}px, ${vfViewport.y}px) scale(${vfViewport.zoom})`,
          transformOrigin: '0 0',
        }"
      >
        <template v-for="a in visibleAnnotations" :key="a.id">
          <StickyAnnotation
            v-if="a.kind === 'sticky'"
            :annotation="(a as any)"
            @drag="(id, dx, dy) => moveAnnotationWithAttach(id, dx, dy)"
            @resize="(id, w, h) => resizeAnnotation(id, w, h)"
            @update="(id, patch) => updateAnnotation(id, patch as any)"
            @remove="(id) => removeAnnotation(id)"
          />
          <ChecklistAnnotationView
            v-else-if="a.kind === 'checklist'"
            :annotation="(a as any)"
            @drag="(id, dx, dy) => moveAnnotationWithAttach(id, dx, dy)"
            @resize="(id, w, h) => resizeAnnotation(id, w, h)"
            @update="(id, patch) => updateAnnotation(id, patch as any)"
            @remove="(id) => removeAnnotation(id)"
          />
          <PinImageAnnotationView
            v-else-if="a.kind === 'pin-image'"
            :annotation="(a as any)"
            @drag="(id, dx, dy) => moveAnnotationWithAttach(id, dx, dy)"
            @resize="(id, w, h) => resizeAnnotation(id, w, h)"
            @update="(id, patch) => updateAnnotation(id, patch as any)"
            @remove="(id) => removeAnnotation(id)"
          />
          <PinResultAnnotationView
            v-else-if="a.kind === 'pin-result'"
            :annotation="(a as any)"
            @drag="(id, dx, dy) => moveAnnotationWithAttach(id, dx, dy)"
            @resize="(id, w, h) => resizeAnnotation(id, w, h)"
            @update="(id, patch) => updateAnnotation(id, patch as any)"
            @remove="(id) => removeAnnotation(id)"
          />
        </template>

        <!-- Arrows: rendered into the same transformed layer so the dashed
             stroke scales naturally with zoom and endpoints stay anchored. -->
        <ArrowsLayer
          :arrows="allRenderedArrows"
          :selected-id="selectedArrowId"
          @context-menu="(id, x, y) => handleArrowContextMenu(id, x, y)"
          @select="(id) => selectArrow(id)"
          @endpoint-drag="(id, which, x, y) => onArrowEndpointDrag(id, which, x, y)"
          @curve-drag="(id, x, y) => onArrowCurveDrag(id, x, y)"
        />
      </div>
    </div>

    <!-- Pending-arrow status hint: appears while the user is drawing an arrow.
         Compact, top-center, dismissable with ESC (handled globally). -->
    <div
      v-if="pendingArrowFrom"
      class="absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-full text-xs font-medium pointer-events-none"
      style="background: rgba(167, 139, 250, 0.95); color: rgb(20, 23, 28);"
    >
      Click target to complete arrow · ESC to cancel
    </div>

    <!-- Inline style toolbar for the selected arrow. Positioned at the curve
         midpoint in screen coords so it doesn't scale with zoom — readable
         at any zoom level. The pop floats above the arrow with a small caret. -->
    <div
      v-if="selectedArrowToolbarPos"
      class="arrow-style-toolbar absolute z-50 flex items-center gap-1 px-1.5 py-1 rounded-[10px] bg-[#1a1a1a]/95 border border-[#2a2a2a] shadow-xl backdrop-blur-sm"
      :style="{
        left: `${selectedArrowToolbarPos.left}px`,
        top: `${selectedArrowToolbarPos.top}px`,
        transform: 'translateX(-50%)',
      }"
      @pointerdown.stop
      @click.stop
    >
      <!-- Color swatches -->
      <button
        v-for="c in ARROW_PALETTE"
        :key="c"
        type="button"
        class="arrow-style-toolbar__swatch"
        :class="{ 'arrow-style-toolbar__swatch--active': selectedArrowToolbarPos.color.toLowerCase() === c.toLowerCase() }"
        :style="{ background: c }"
        :title="c"
        @click="setSelectedArrowColor(c)"
      />
      <div class="w-px h-5 bg-white/10 mx-0.5" />
      <!-- Thickness -->
      <button
        v-for="t in ARROW_THICKNESSES"
        :key="t"
        type="button"
        class="arrow-style-toolbar__thickness"
        :class="{ 'arrow-style-toolbar__thickness--active': Math.abs(selectedArrowToolbarPos.thickness - t) < 0.1 }"
        :title="`Thickness ${t}`"
        @click="setSelectedArrowThickness(t)"
      >
        <span :style="{ height: `${t}px`, background: selectedArrowToolbarPos.color }" />
      </button>
      <div class="w-px h-5 bg-white/10 mx-0.5" />
      <!-- Label + delete -->
      <button
        type="button"
        class="arrow-style-toolbar__btn"
        title="Edit label"
        @click="editSelectedArrowLabel"
      >
        <Edit3 class="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        class="arrow-style-toolbar__btn arrow-style-toolbar__btn--danger"
        title="Delete arrow"
        @click="deleteSelectedArrow"
      >
        <Trash2 class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Context menu (floats in screen space, not graph space) -->
    <CanvasContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menu.items"
      @close="closeMenu"
    />

    <!-- Subgraph breadcrumb navigation -->
    <div v-if="isInsideSubgraph" class="absolute top-3 left-3 z-40">
      <SubgraphBreadcrumb :breadcrumbs="breadcrumbs" @navigate="handleBreadcrumbNavigate" />
    </div>

    <!-- Compositor editor modal -->
    <Teleport to="body">
      <VueCanvasCompositorModal
        v-if="compositorOpenForId"
        :node-id="compositorOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="compositorOpenForId = null"
      />
    </Teleport>

    <!-- Kinetic Typography editor modal -->
    <Teleport to="body">
      <VueCanvasKineticTypeModal
        v-if="kineticTypeOpenForId"
        :node-id="kineticTypeOpenForId"
        :nodes="nodes as any[]"
        @close="kineticTypeOpenForId = null"
      />
    </Teleport>

    <!-- ASCII options right drawer -->
    <Teleport to="body">
      <VueCanvasAsciiPanel
        v-if="asciiOpenForId"
        :node-id="asciiOpenForId"
        :nodes="nodes as any[]"
        @close="asciiOpenForId = null"
      />
    </Teleport>

    <!-- Timeline editor (full-screen multi-track) -->
    <Teleport to="body">
      <VueCanvasTimelineEditor
        v-if="timelineOpenForId"
        :node-id="timelineOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="timelineOpenForId = null"
      />
    </Teleport>

    <!-- Crossfade editor modal -->
    <Teleport to="body">
      <VueCanvasCrossfadeModal
        v-if="crossfadeOpenForId"
        :node-id="crossfadeOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="crossfadeOpenForId = null"
      />
    </Teleport>

    <!-- SmartLayout visual editor modal -->
    <Teleport to="body">
      <VueCanvasSmartLayoutEditorModal
        v-if="smartLayoutOpenForId"
        :node-id="smartLayoutOpenForId"
        :nodes="nodes as any[]"
        :edges="edges as any[]"
        @close="smartLayoutOpenForId = null"
      />
    </Teleport>

    <!-- Model gallery (image generator model picker) -->
    <VueCanvasModelGalleryModal
      v-if="modelGalleryOpenForId"
      :node-id="modelGalleryOpenForId"
      :nodes="nodes as any[]"
      @close="modelGalleryOpenForId = null"
    />

    <!-- LoRA gallery — opened from the FluxLoRARemoteNode lora_name launcher. -->
    <VueCanvasLoraGalleryModal
      v-if="loraGalleryOpenForId"
      :node-id="loraGalleryOpenForId"
      :nodes="nodes as any[]"
      @close="loraGalleryOpenForId = null"
    />

    <!-- Video model gallery — opened from the GenerateVideoNode launcher. -->
    <VueCanvasVideoModelGalleryModal
      v-if="videoModelGalleryOpenForId"
      :node-id="videoModelGalleryOpenForId"
      :nodes="nodes as any[]"
      @close="videoModelGalleryOpenForId = null"
    />

    <!-- Text effect gallery — opened from the TextEffectNode launcher. -->
    <VueCanvasTextEffectGalleryModal
      v-if="textEffectGalleryOpenForId"
      :node-id="textEffectGalleryOpenForId"
      :nodes="nodes as any[]"
      @close="textEffectGalleryOpenForId = null"
    />
  </div>
</template>

<style>
/* Override Vue Flow defaults to match ComfyNext dark theme */
.vue-node-canvas .vue-flow__node {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  box-shadow: none;
}

.vue-node-canvas .vue-flow__node.selected .comfy-node {
  outline: 2px solid #818cf8;
  outline-offset: 1px;
}

/* Artifact cards use their own root classes (not .comfy-node), so the rule
   above never reached them — they got selected on click but showed no ring,
   which read as "can't select". Mirror the highlight on every artifact root. */
.vue-node-canvas .vue-flow__node.selected .artifact-image,
.vue-node-canvas .vue-flow__node.selected .artifact-video,
.vue-node-canvas .vue-flow__node.selected .artifact-audio,
.vue-node-canvas .vue-flow__node.selected .artifact-text,
.vue-node-canvas .vue-flow__node.selected .artifact-frame-node,
.vue-node-canvas .vue-flow__node.selected .artifact-timeline {
  outline: 2px solid #818cf8;
  outline-offset: 3px;
  border-radius: 12px;
}

.vue-node-canvas .vue-flow__edge.selected path {
  filter: drop-shadow(0 0 4px currentColor);
}

.vue-node-canvas .vue-flow__handle {
  background: transparent;
  border: none;
}

.vue-node-canvas {
  background-color: transparent;
}

/* Connection line while dragging */
.vue-node-canvas .vue-flow__connection-line path {
  stroke: #818cf8;
  stroke-width: 2;
  stroke-dasharray: 5;
}

/* MiniMap positioning: sit above the zoom toolbar, right-aligned */
.vue-node-canvas .comfy-minimap.vue-flow__panel {
  bottom: 52px !important;
  right: 0 !important;
  margin-right: 12px !important;
  margin-bottom: 0 !important;
  border-radius: 12px !important;
  overflow: hidden;
}

/* Floating style toolbar shown above the currently-selected arrow. */
.arrow-style-toolbar__swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: transform 80ms, box-shadow 80ms;
}
.arrow-style-toolbar__swatch:hover {
  transform: scale(1.12);
}
.arrow-style-toolbar__swatch--active {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85);
}

/* Thickness button: a horizontal bar at the chosen thickness. Subtle, but
   matches what the bar will look like when applied. */
.arrow-style-toolbar__thickness {
  width: 24px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  transition: background 80ms;
}
.arrow-style-toolbar__thickness:hover {
  background: rgba(255, 255, 255, 0.08);
}
.arrow-style-toolbar__thickness--active {
  background: rgba(255, 255, 255, 0.14);
}
.arrow-style-toolbar__thickness > span {
  display: block;
  width: 16px;
  border-radius: 2px;
}

.arrow-style-toolbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 22px;
  border-radius: 4px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: background 80ms, color 80ms;
}
.arrow-style-toolbar__btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}
.arrow-style-toolbar__btn--danger:hover {
  background: rgba(220, 38, 38, 0.3);
  color: rgb(254, 202, 202);
}

</style>
