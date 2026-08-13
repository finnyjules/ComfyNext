/**
 * Reference upload for the Shot Director. Files go to the ComfyUI input dir
 * via the existing /upload/image rail (it accepts video/audio too — see
 * ArtifactVideoNode) and the sheet stores the small '/view?…&type=input' URL
 * instead of a multi-MB data URL. Data URLs bloated the workflow JSON (the
 * refs get copied into the FilmShotNode's model_options widget on Generate)
 * and silently broke sessionStorage tab persistence past the ~5MB quota.
 * The Python side (nodes_replicate._resolve_local_refs) turns these back
 * into data URLs at execute time — Replicate can't fetch 127.0.0.1.
 */

export function viewRefUrl(name: string): string {
  return `/view?${new URLSearchParams({ filename: name, type: 'input' })}`
}

/** Upload a file to the ComfyUI input dir, returning the bare filename (not
 *  a /view URL) — the shape callers need when they're about to store the
 *  filename directly (e.g. a CharacterState panel) rather than render it. */
export async function uploadRefFilename(file: File): Promise<string> {
  const fd = new FormData()
  // Timestamped name avoids clobbering same-named uploads ('image.png').
  fd.append('image', file, `sd-ref_${Date.now()}_${file.name}`)
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`upload ${res.status}`)
  const name = (await res.json())?.name
  if (!name) throw new Error('upload returned no name')
  return name
}

export async function uploadRefFile(file: File): Promise<string> {
  return viewRefUrl(await uploadRefFilename(file))
}
