/**
 * Block Library — saved-group reusable templates.
 *
 * A Block is a chunk of a workflow (the nodes inside a group + their internal
 * links + the wrapping group rectangle) that the user has saved for reuse
 * across any other workflow. Stored in localStorage for v1 so it ships
 * without backend changes; the shape is intentionally simple so lifting to a
 * server-backed library later is a small follow-up.
 *
 * Position normalization: at save time, every node's x/y is rewritten to be
 * relative to the group's origin (so the leftmost/topmost node ends up at
 * roughly (0, 0)). At insert time we add the drop point back, so blocks can
 * land anywhere on the new canvas.
 */

import type { LiteGraphNode } from '~/composables/useVueNodes'

export interface Block {
  id: string
  name: string
  color: string
  /** Nodes with positions relative to the group's top-left. */
  nodes: LiteGraphNode[]
  /** Internal links between the contained nodes. LiteGraph tuple format. */
  links: any[]
  /** Group bounding box dimensions — used to re-create the wrapping group. */
  bounds: { width: number; height: number }
  createdAt: number
}

const STORAGE_KEY = 'sailor:blocks'

function readStorage(): Block[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.warn('[useBlockLibrary] failed to read storage:', err)
    return []
  }
}

function writeStorage(blocks: Block[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks))
  } catch (err) {
    console.warn('[useBlockLibrary] failed to write storage:', err)
  }
}

function newId(): string {
  return `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// Singleton — multiple call sites (panel + canvas + save action) share the
// same ref so saves reflect immediately everywhere without prop drilling.
let _blocks: Ref<Block[]> | null = null

export function useBlockLibrary() {
  if (!_blocks) {
    _blocks = ref<Block[]>(readStorage())
    // Cross-tab sync — when another tab updates the library, refresh ours.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === STORAGE_KEY) {
          _blocks!.value = readStorage()
        }
      })
    }
  }
  const blocks = _blocks

  /**
   * Save a block. Caller supplies the raw payload (nodes + links + bounds
   * + color); this function normalizes node positions to the group origin
   * before persisting.
   */
  function saveBlock(input: {
    name: string
    color: string
    nodes: LiteGraphNode[]
    links: any[]
    bounds: { width: number; height: number }
    /** Origin to subtract from every node position so they become relative. */
    origin: { x: number; y: number }
  }): Block {
    const { origin } = input
    const normalizedNodes: LiteGraphNode[] = input.nodes.map(n => ({
      ...n,
      pos: [n.pos[0] - origin.x, n.pos[1] - origin.y] as [number, number],
    }))
    const block: Block = {
      id: newId(),
      name: input.name.trim() || 'Untitled Block',
      color: input.color,
      nodes: normalizedNodes,
      links: input.links,
      bounds: input.bounds,
      createdAt: Date.now(),
    }
    blocks.value = [block, ...blocks.value]
    writeStorage(blocks.value)
    return block
  }

  function deleteBlock(id: string) {
    blocks.value = blocks.value.filter(b => b.id !== id)
    writeStorage(blocks.value)
  }

  function renameBlock(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const idx = blocks.value.findIndex(b => b.id === id)
    if (idx < 0) return
    blocks.value = blocks.value.map((b, i) => i === idx ? { ...b, name: trimmed } : b)
    writeStorage(blocks.value)
  }

  function getBlock(id: string): Block | undefined {
    return blocks.value.find(b => b.id === id)
  }

  /** Wipe the entire library — used by tests, not exposed in UI. */
  function _clearForTests() {
    blocks.value = []
    writeStorage([])
  }

  return {
    blocks,
    saveBlock,
    deleteBlock,
    renameBlock,
    getBlock,
    _clearForTests,
  }
}
