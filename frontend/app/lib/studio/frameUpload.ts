/**
 * Upload a batch of frame blobs to the ComfyUI server.
 * Returns an array of filenames that the Python node can load.
 *
 * Moved verbatim out of ~/composables/useKineticRenderer — this is the
 * shared upload path every studio (Shape, Gradient, Texture, Shader, Space
 * Type), the Compositor, and both bake modules use to publish baked frame
 * sequences. Nothing here is kinetic-specific.
 */
export async function uploadFrameBatch(
  frames: Blob[],
  prefix: string = 'kinetic',
): Promise<string[]> {
  const filenames: string[] = []

  for (let i = 0; i < frames.length; i++) {
    const fd = new FormData()
    const fname = `${prefix}_${Date.now()}_${String(i).padStart(4, '0')}.png`
    fd.append('image', new File([frames[i]], fname, { type: 'image/png' }))
    fd.append('overwrite', 'true')

    try {
      const res = await fetch('/upload/image', { method: 'POST', body: fd })
      if (res.ok) {
        const data = await res.json() as { name?: string; subfolder?: string }
        const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name || fname)
        filenames.push(name)
      }
    } catch {
      // Skip failed frames — the batch will be shorter but usable
    }
  }

  return filenames
}
