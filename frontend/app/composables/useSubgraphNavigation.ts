import { subgraphToLiteGraph } from '~/composables/useVueNodes'
import type { LiteGraphWorkflow } from '~/composables/useVueNodes'

interface StackEntry {
  subgraphId: string | null // null = root level
  name: string
  nodesSnapshot: any[] // Vue Flow nodes at this level
  edgesSnapshot: any[] // Vue Flow edges at this level
}

export function useSubgraphNavigation() {
  const stack = ref<StackEntry[]>([])

  const isInsideSubgraph = computed(() => stack.value.length > 0)

  const currentSubgraphId = computed(() =>
    stack.value.length > 0 ? stack.value[stack.value.length - 1].subgraphId : null,
  )

  const breadcrumbs = computed(() => {
    const crumbs = [{ name: 'Main', index: -1 }]
    for (let i = 0; i < stack.value.length; i++) {
      crumbs.push({ name: stack.value[i].name, index: i })
    }
    return crumbs
  })

  /**
   * Enter a subgraph: snapshot current state, return the inner workflow to render.
   */
  function enterSubgraph(
    subgraphId: string,
    subgraphName: string,
    currentNodes: any[],
    currentEdges: any[],
    definitions: { subgraphs?: any[] },
  ): LiteGraphWorkflow | null {
    const sgDef = definitions.subgraphs?.find((sg: any) => sg.id === subgraphId)
    if (!sgDef) {
      console.warn('[SubgraphNav] No definition found for subgraph:', subgraphId)
      return null
    }

    // Snapshot current state before navigating in
    stack.value.push({
      subgraphId,
      name: subgraphName,
      nodesSnapshot: JSON.parse(JSON.stringify(currentNodes)),
      edgesSnapshot: JSON.parse(JSON.stringify(currentEdges)),
    })

    return subgraphToLiteGraph(sgDef)
  }

  /**
   * Navigate back to a specific level (by breadcrumb index).
   * index=-1 means root, 0 means first subgraph level, etc.
   * Returns the nodes/edges snapshot to restore.
   */
  function exitToLevel(
    targetIndex: number,
    currentNodes: any[],
    currentEdges: any[],
    definitions: { subgraphs?: any[] },
    convertToLiteGraph: () => LiteGraphWorkflow,
  ): { nodes: any[]; edges: any[] } | null {
    if (stack.value.length === 0) return null

    // Save current subgraph state back to definitions before leaving
    saveCurrentSubgraph(currentNodes, currentEdges, definitions, convertToLiteGraph)

    // Determine how many levels to pop
    // targetIndex=-1 means pop everything (go to root)
    // targetIndex=0 means pop down to first entry (keep 0, but we want to GO to that level's parent)
    const popCount = targetIndex === -1
      ? stack.value.length
      : stack.value.length - targetIndex

    if (popCount <= 0) return null

    // The entry we're navigating TO is the one at targetIndex (or root if -1)
    // We need the snapshot from the first entry we're popping
    const firstPoppedIndex = stack.value.length - popCount
    const targetEntry = stack.value[firstPoppedIndex]

    // Pop the stack
    stack.value.splice(firstPoppedIndex, popCount)

    return {
      nodes: targetEntry.nodesSnapshot,
      edges: targetEntry.edgesSnapshot,
    }
  }

  /**
   * Save current subgraph state back into the definitions array.
   */
  function saveCurrentSubgraph(
    _currentNodes: any[],
    _currentEdges: any[],
    definitions: { subgraphs?: any[] },
    convertToLiteGraph: () => LiteGraphWorkflow,
  ) {
    if (!isInsideSubgraph.value || !definitions.subgraphs) return

    const currentSgId = currentSubgraphId.value
    const sgIndex = definitions.subgraphs.findIndex((sg: any) => sg.id === currentSgId)
    if (sgIndex === -1) return

    // Convert current Vue Flow state back to LiteGraph format
    const lgWorkflow = convertToLiteGraph()

    // Update the subgraph definition in-place
    const sg = definitions.subgraphs[sgIndex]
    sg.nodes = lgWorkflow.nodes
    sg.links = lgWorkflow.links
    sg.groups = lgWorkflow.groups
    sg.extra = lgWorkflow.extra
    sg.state = {
      ...sg.state,
      lastNodeId: lgWorkflow.last_node_id,
      lastLinkId: lgWorkflow.last_link_id,
    }
  }

  function reset() {
    stack.value = []
  }

  return {
    stack,
    isInsideSubgraph,
    currentSubgraphId,
    breadcrumbs,
    enterSubgraph,
    exitToLevel,
    saveCurrentSubgraph,
    reset,
  }
}
