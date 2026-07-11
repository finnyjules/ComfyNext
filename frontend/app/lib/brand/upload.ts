// frontend/app/lib/brand/upload.ts
/** Upload a brand image (logo slot / asset) to the ComfyUI input folder and
 *  return its `/view` URL — the format BrandKit stores. Same endpoint the
 *  Frame uses for image layers, so brand files are layer-ready by name. */
export async function uploadBrandImage(file: File): Promise<string> {
  const safe = `brand_${Date.now().toString(36)}_${(file.name || 'image.png').replace(/[^\w.-]+/g, '_')}`
  const fd = new FormData()
  fd.append('image', new File([file], safe, { type: file.type }))
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`brand upload failed: ${res.status}`)
  const data = await res.json() as { name?: string; subfolder?: string }
  const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
  if (!name) throw new Error('brand upload returned no filename')
  return `/view?filename=${encodeURIComponent(name)}&type=input`
}
