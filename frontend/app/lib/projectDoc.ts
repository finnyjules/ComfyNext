/**
 * ProjectDoc — the multi-canvas project document.
 *
 * A project tab no longer holds a single workflow but a ProjectDoc: an ordered
 * list of named canvases, each with its own workflow, plus which one is shown.
 * The doc is the unit of persistence everywhere — sessionStorage, the rolling
 * durable autosave, and named versions all store the whole doc, so restoring a
 * version brings back every canvas. Anything that hands us a bare workflow
 * (old sessions, old durable versions, /history, community templates) gets
 * wrapped into a one-canvas doc via toProjectDoc at the entry point, so the
 * rest of the code only ever sees docs. The backend never inspects version
 * bodies, so this needs no server-side changes.
 */

export interface ProjectCanvas { id: string; name: string; workflow: any }
export interface ProjectDoc { canvases: ProjectCanvas[]; activeCanvasId: string }

export const BLANK_WORKFLOW = { last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }

let _canvasSeq = 0
export function makeCanvasId(): string {
  _canvasSeq += 1
  return `cv_${Date.now().toString(36)}_${_canvasSeq}`
}

export function makeBlankWorkflow(): any {
  return JSON.parse(JSON.stringify(BLANK_WORKFLOW))
}

export function isProjectDoc(x: any): x is ProjectDoc {
  return !!x && Array.isArray(x.canvases)
}

/** Wrap a legacy bare workflow (or nothing) into a one-canvas doc. Docs pass through. */
export function toProjectDoc(x: any): ProjectDoc {
  if (isProjectDoc(x)) return x
  const id = makeCanvasId()
  const workflow = (x && typeof x === 'object') ? x : makeBlankWorkflow()
  return { canvases: [{ id, name: 'Canvas 1', workflow }], activeCanvasId: id }
}

export function activeCanvasOf(doc: ProjectDoc): ProjectCanvas {
  return doc.canvases.find((c) => c.id === doc.activeCanvasId) ?? doc.canvases[0]!
}

/** Does this doc (or legacy bare workflow) contain any real content? */
export function docHasContent(x: any): boolean {
  if (isProjectDoc(x)) return x.canvases.some((c) => (c.workflow?.nodes?.length ?? 0) > 0)
  return (x?.nodes?.length ?? 0) > 0
}

/** Next available "Canvas N" name that doesn't collide with existing ones. */
export function nextCanvasName(doc: ProjectDoc): string {
  let n = doc.canvases.length + 1
  while (doc.canvases.some((c) => c.name === `Canvas ${n}`)) n += 1
  return `Canvas ${n}`
}
