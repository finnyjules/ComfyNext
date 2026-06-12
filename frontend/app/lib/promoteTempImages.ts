/**
 * Promote ephemeral `temp`-preview artifact images into durable `input` uploads
 * before a workflow is submitted.
 *
 * A standalone `Image` artifact that shows a generation result, wired into a
 * downstream node, gets its `image` widget backfilled with the shown file's
 * annotated path (see `backfillStandaloneArtifactImages`). For a result saved to
 * the temp dir that path is `name [temp]` — but ComfyUI wipes temp/ on startup,
 * so after a restart the file is gone and `LoadImage.VALIDATE_INPUTS` rejects the
 * run ("Invalid image file: … [temp]"). Output-dir results persist, so only
 * `[temp]` references are fragile.
 *
 * This re-uploads each such image into the input dir (which survives restarts)
 * and rewrites the widget to the bare input filename. If the temp bytes are
 * already gone, it throws a clear, actionable error instead of letting the
 * backend fail cryptically.
 */

export interface TempImageRef {
  nodeIndex: number
  widgetIndex: number
  filename: string   // bare filename (no annotation, no subfolder)
  subfolder: string  // '' when the file sits directly in temp/
  viewUrl: string    // same-origin /view URL to fetch the bytes
}

export interface PromoteDeps {
  /** Defaults to same-origin `fetch`. Returns at least `{ ok, blob() }`. */
  fetchFn?: (url: string) => Promise<{ ok: boolean; blob: () => Promise<Blob> }>
  /** Upload the bytes into ComfyUI's input dir; returns the stored filename. */
  uploadFn?: (blob: Blob, filename: string) => Promise<string>
}

interface PromoteWorkflow { nodes?: any[] }

const TEMP_SUFFIX = ' [temp]'

/**
 * Pure scan: find every `Image` node widget value annotated `… [temp]` and
 * reconstruct the same-origin `/view` URL to fetch it. No I/O, no DOM.
 */
export function planTempImagePromotion(workflow: PromoteWorkflow): TempImageRef[] {
  const refs: TempImageRef[] = []
  const nodes = workflow?.nodes
  if (!Array.isArray(nodes)) return refs
  nodes.forEach((node: any, nodeIndex: number) => {
    if (node?.type !== 'Image' || !Array.isArray(node.widgets_values)) return
    node.widgets_values.forEach((v: any, widgetIndex: number) => {
      if (typeof v !== 'string' || !v.endsWith(TEMP_SUFFIX)) return
      const inner = v.slice(0, -TEMP_SUFFIX.length)
      const slash = inner.lastIndexOf('/')
      const subfolder = slash >= 0 ? inner.slice(0, slash) : ''
      const filename = slash >= 0 ? inner.slice(slash + 1) : inner
      if (!filename) return // malformed annotation (e.g. bare " [temp]") — skip
      const params = new URLSearchParams({ filename, type: 'temp' })
      if (subfolder) params.set('subfolder', subfolder)
      refs.push({ nodeIndex, widgetIndex, filename, subfolder, viewUrl: `/view?${params.toString()}` })
    })
  })
  return refs
}

/** Default uploader: POST the bytes to ComfyUI's input dir (browser only). */
async function uploadBlobToInput(blob: Blob, filename: string): Promise<string> {
  const fd = new FormData()
  fd.append('image', new File([blob], filename, { type: blob.type || 'image/png' }))
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`upload failed (${res.status})`)
  return (await res.json())?.name || filename
}

/**
 * Mutates `workflow` in place: re-uploads each `[temp]` image to the input dir
 * and rewrites its widget to the durable bare filename. Throws if any temp file
 * is already gone (so a doomed run is aborted with a useful message rather than
 * a cryptic backend validation error).
 */
export async function promoteTempImageInputs(
  workflow: PromoteWorkflow,
  deps: PromoteDeps = {},
): Promise<{ promoted: number; missing: string[] }> {
  const refs = planTempImagePromotion(workflow)
  if (!refs.length) return { promoted: 0, missing: [] }

  const fetchFn = deps.fetchFn ?? ((url: string) => fetch(url))
  const uploadFn = deps.uploadFn ?? uploadBlobToInput
  const missing: string[] = []
  let promoted = 0

  for (const ref of refs) {
    let res: { ok: boolean; blob: () => Promise<Blob> }
    try {
      res = await fetchFn(ref.viewUrl)
    } catch {
      missing.push(ref.filename)
      continue
    }
    if (!res.ok) { missing.push(ref.filename); continue }
    // Fetched fine but the upload to input failed — that's a distinct error
    // (network/server), not an expired source, so don't fold it into `missing`.
    let name: string
    try {
      name = await uploadFn(await res.blob(), ref.filename)
    } catch (uploadErr) {
      throw new Error(`Couldn't save "${ref.filename}" into the input folder: ${String((uploadErr as any)?.message ?? uploadErr)}`)
    }
    ;(workflow.nodes as any[])[ref.nodeIndex].widgets_values[ref.widgetIndex] = name
    promoted++
  }

  if (missing.length) {
    const many = missing.length > 1
    throw new Error(
      `Source image${many ? 's' : ''} expired (temporary preview${many ? 's were' : ' was'} cleared): ` +
      `${missing.join(', ')}. Re-run or re-load ${many ? 'them' : 'it'}, then run again.`,
    )
  }
  return { promoted, missing }
}
