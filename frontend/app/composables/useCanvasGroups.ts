import type { Node } from '@vue-flow/core'
import { useVueFlow } from '@vue-flow/core'

/**
 * Canvas groups are loose visual containers — a labeled rectangle drawn
 * behind nodes. Nodes whose center lies inside the rectangle are considered
 * "members" of the group (spatial, not parented). Dragging the group moves
 * its members by the same delta.
 *
 * Persists round-trip in the LiteGraph workflow JSON's `groups` array as
 * `{ title, bounding: [x, y, w, h], color, font_size }`.
 */

export interface CanvasGroup {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  color: string
}

// Swatch palette — matches the curated type-color palette so groups visually
// rhyme with edges flowing through them. Light-on-dark canvas, so picks lean
// saturated rather than pastel.
export const GROUP_COLORS: string[] = [
  '#60a5fa', // blue
  '#4ade80', // green
  '#f472b6', // pink
  '#fb923c', // orange
  '#c084fc', // purple
  '#facc15', // yellow
  '#34d399', // emerald
  '#94a3b8', // slate
]

const PADDING = 24
const TITLE_BAR_HEIGHT = 28

type VueFlowNode = Node<Record<string, any>>

interface NodeWithSize {
  id: string
  position: { x: number; y: number }
  data?: { size?: [number, number] }
  // Vue Flow attaches measured DOM dimensions here after the node renders.
  // These reflect dynamic content (uploaded images, expanded widgets) and
  // are what we want for group-bounds math — `data.size` is only the
  // serialized initial guess, which is wrong for any node that has grown.
  dimensions?: { width: number; height: number }
}

function nodeBounds(n: NodeWithSize): { x: number; y: number; w: number; h: number } {
  const measuredW = n.dimensions?.width
  const measuredH = n.dimensions?.height
  const w = (measuredW && measuredW > 0) ? measuredW : (n.data?.size?.[0] ?? 220)
  const h = (measuredH && measuredH > 0) ? measuredH : (n.data?.size?.[1] ?? 120)
  return { x: n.position.x, y: n.position.y, w, h }
}

function nodeCenter(n: NodeWithSize): { x: number; y: number } {
  const b = nodeBounds(n)
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

function pointInRect(
  px: number, py: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh
}

function newId(): string {
  // Group IDs don't intersect node IDs (which are numeric strings). Prefix to
  // make filtering trivial.
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function useCanvasGroups(nodesRef: Ref<VueFlowNode[]>) {
  const groups = ref<CanvasGroup[]>([])
  let colorCursor = 0

  // Read live measured dimensions from the DOM. Vue Flow's user-facing nodes
  // array doesn't carry `dimensions`, and calling `useVueFlow().findNode()`
  // from this composable depends on injection timing that isn't guaranteed
  // here. The rendered .vue-flow__node element always has the right size, so
  // we measure it directly. Width/height are screen-space, but at zoom=1
  // they equal graph-space; otherwise we divide by the current zoom.
  const { viewport: vfViewport } = useVueFlow()

  function resolvedDimensions(n: VueFlowNode): { width: number; height: number } | null {
    if (typeof document === 'undefined') return null
    const el = document.querySelector(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`) as HTMLElement | null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const zoom = vfViewport.value.zoom || 1
    const w = rect.width / zoom
    const h = rect.height / zoom
    if (w > 0 && h > 0) return { width: w, height: h }
    return null
  }

  /** Compute the bounding rect that fully encloses the given nodes, with padding. */
  function boundsFromNodes(targetNodes: VueFlowNode[]): { x: number; y: number; width: number; height: number } | null {
    if (!targetNodes.length) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of targetNodes) {
      const measured = resolvedDimensions(n)
      const b = nodeBounds({ ...(n as NodeWithSize), dimensions: measured ?? undefined })
      if (b.x < minX) minX = b.x
      if (b.y < minY) minY = b.y
      if (b.x + b.w > maxX) maxX = b.x + b.w
      if (b.y + b.h > maxY) maxY = b.y + b.h
    }
    if (!Number.isFinite(minX)) return null
    return {
      x: minX - PADDING,
      y: minY - PADDING - TITLE_BAR_HEIGHT,
      width: (maxX - minX) + PADDING * 2,
      height: (maxY - minY) + PADDING * 2 + TITLE_BAR_HEIGHT,
    }
  }

  function createGroupFromSelection(selectedIds: string[], opts: { title?: string; color?: string } = {}): CanvasGroup | null {
    const selected = (nodesRef.value as VueFlowNode[]).filter(n => selectedIds.includes(n.id))
    if (!selected.length) return null
    const b = boundsFromNodes(selected)
    if (!b) return null
    const group: CanvasGroup = {
      id: newId(),
      title: opts.title ?? 'Group',
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      color: opts.color ?? GROUP_COLORS[colorCursor++ % GROUP_COLORS.length]!,
    }
    groups.value.push(group)
    return group
  }

  /** AABB test — returns ids of nodes whose center is inside the group bounds. */
  function nodesInGroup(groupId: string): string[] {
    const g = groups.value.find(g => g.id === groupId)
    if (!g) return []
    const ids: string[] = []
    for (const n of nodesRef.value as VueFlowNode[]) {
      const measured = resolvedDimensions(n)
      const c = nodeCenter({ ...(n as NodeWithSize), dimensions: measured ?? undefined })
      if (pointInRect(c.x, c.y, g.x, g.y, g.width, g.height)) ids.push(n.id)
    }
    return ids
  }

  /** Move group rect AND every contained node by (dx, dy). */
  function dragGroup(groupId: string, dx: number, dy: number) {
    const g = groups.value.find(g => g.id === groupId)
    if (!g) return
    // Snapshot membership BEFORE we move, so the spatial test is consistent.
    const memberIds = new Set(nodesInGroup(groupId))
    g.x += dx
    g.y += dy
    for (const n of nodesRef.value as VueFlowNode[]) {
      if (!memberIds.has(n.id)) continue
      n.position = { x: n.position.x + dx, y: n.position.y + dy }
    }
  }

  function resizeGroup(groupId: string, width: number, height: number) {
    const g = groups.value.find(g => g.id === groupId)
    if (!g) return
    // Don't shrink below a usable minimum.
    g.width = Math.max(120, width)
    g.height = Math.max(TITLE_BAR_HEIGHT + 40, height)
  }

  function updateGroup(groupId: string, patch: Partial<CanvasGroup>) {
    const idx = groups.value.findIndex(g => g.id === groupId)
    if (idx < 0) return
    const current = groups.value[idx]!
    groups.value[idx] = { ...current, ...patch, id: current.id }
  }

  function deleteGroup(groupId: string) {
    groups.value = groups.value.filter(g => g.id !== groupId)
  }

  /** Replace all groups with the given list (used when loading a workflow). */
  function setGroups(next: CanvasGroup[]) {
    groups.value = next
  }

  function clear() {
    groups.value = []
  }

  // ---- LiteGraph round-trip --------------------------------------------------

  function toLiteGraph(): any[] {
    return groups.value.map(g => ({
      title: g.title,
      bounding: [g.x, g.y, g.width, g.height],
      color: g.color,
      font_size: 24,
    }))
  }

  function fromLiteGraph(raw: any[] | undefined | null): CanvasGroup[] {
    if (!Array.isArray(raw)) return []
    return raw.map((g, idx) => {
      const b = Array.isArray(g.bounding) ? g.bounding : [0, 0, 200, 120]
      return {
        id: newId() + `_${idx}`,
        title: typeof g.title === 'string' ? g.title : 'Group',
        x: Number(b[0]) || 0,
        y: Number(b[1]) || 0,
        width: Number(b[2]) || 200,
        height: Number(b[3]) || 120,
        color: typeof g.color === 'string' ? g.color : GROUP_COLORS[idx % GROUP_COLORS.length]!,
      }
    })
  }

  return {
    groups,
    createGroupFromSelection,
    nodesInGroup,
    dragGroup,
    resizeGroup,
    updateGroup,
    deleteGroup,
    setGroups,
    clear,
    toLiteGraph,
    fromLiteGraph,
    // Exposed for testing
    _boundsFromNodes: boundsFromNodes,
  }
}
