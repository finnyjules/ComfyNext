/**
 * Client helpers for the Compositor inpainting feature: talk to the
 * /api/inpaint/* routes, plus the image plumbing (load → cap → data URL, and
 * re-upload a result into ComfyUI's input dir so it can become an image layer).
 *
 * Geometry (where the mask sits on the artboard) lives in the Compositor, which
 * owns the layer transforms; this composable stays transform-agnostic.
 */

export interface FluxFillOpts {
  tier?: 'dev' | 'pro'
  count?: number
  guidance?: number
  steps?: number
  seed?: number
}

/** Load an image URL (same-origin /view URLs or data URLs) to an HTMLImageElement. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.crossOrigin = 'anonymous'
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error(`Could not load image: ${url}`))
    im.src = url
  })
}

/** Cap (w,h) so the longest side ≤ max, preserving aspect. Controls model cost. */
export function capDims(w: number, h: number, max = 1536): { w: number; h: number } {
  const longest = Math.max(w, h)
  if (longest <= max) return { w: Math.round(w), h: Math.round(h) }
  const k = max / longest
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** Draw an image into a w×h canvas and return a PNG data URL. */
export function imageToDataUrl(img: HTMLImageElement, w: number, h: number): string {
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h))
  const ctx = cv.getContext('2d')!
  ctx.drawImage(img, 0, 0, cv.width, cv.height)
  return cv.toDataURL('image/png')
}

/** Convert a data URL to a File for FormData upload. */
function dataUrlToFile(dataUrl: string, filename: string): File {
  const comma = dataUrl.indexOf(',')
  const head = dataUrl.slice(0, comma)
  const b64 = dataUrl.slice(comma + 1)
  const mime = /data:(.*?);/.exec(head)?.[1] || 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], filename, { type: mime })
}

export function useInpaint() {
  const busy = ref(false)
  const error = ref('')
  const results = ref<string[]>([]) // data URLs returned by the last generation

  /** Run FLUX Fill. Returns the generated images as data URLs. */
  async function fluxFill(image: string, mask: string, prompt: string, opts: FluxFillOpts = {}): Promise<string[]> {
    busy.value = true; error.value = ''
    try {
      const res = await $fetch<{ images: string[] }>('/api/inpaint/flux-fill', {
        method: 'POST',
        body: {
          image, mask, prompt,
          tier: opts.tier ?? 'dev',
          count: opts.count ?? 1,
          guidance: opts.guidance,
          steps: opts.steps,
          seed: opts.seed,
        },
      })
      results.value = res.images
      return res.images
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Inpaint failed'
      throw err
    } finally {
      busy.value = false
    }
  }

  /** Mask-free instruction edit via FLUX Kontext (v3 "describe the change" mode). */
  async function kontext(image: string, prompt: string, opts: { count?: number } = {}): Promise<string[]> {
    busy.value = true; error.value = ''
    try {
      const res = await $fetch<{ images: string[] }>('/api/inpaint/kontext', {
        method: 'POST',
        body: { image, prompt, count: opts.count ?? 1 },
      })
      results.value = res.images
      return res.images
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Edit failed'
      throw err
    } finally {
      busy.value = false
    }
  }

  /** Text-to-image via FLUX.1 [dev] — used when a region has no underlying
   *  image to inpaint, so we conjure a fresh subject instead. */
  async function text2img(prompt: string, aspectRatio = '1:1', opts: { count?: number; seed?: number } = {}): Promise<string[]> {
    busy.value = true; error.value = ''
    try {
      const res = await $fetch<{ images: string[] }>('/api/inpaint/text2img', {
        method: 'POST',
        body: { prompt, aspect_ratio: aspectRatio, count: opts.count ?? 1, seed: opts.seed },
      })
      results.value = res.images
      return res.images
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Generation failed'
      throw err
    } finally {
      busy.value = false
    }
  }

  /** Click-to-select a region: SAM returns a mask data URL (white = selected).
   *  `pointPx` is in the source image's pixel space (same space as `image`).
   *  (v3 click-to-select.) */
  async function segment(image: string, pointPx: { x: number; y: number }): Promise<string> {
    const res = await $fetch<{ mask: string }>('/api/inpaint/segment', {
      method: 'POST',
      body: { image, xPx: pointPx.x, yPx: pointPx.y },
    })
    return res.mask
  }

  /** Upload a data-URL image into ComfyUI's input dir; returns its filename.
   *  Mirrors useLocalLayerEditor.addImageFromFile's upload path. */
  async function uploadDataUrl(dataUrl: string, nameHint = 'inpaint'): Promise<string> {
    const safe = `${nameHint}_${Date.now()}.png`
    const fd = new FormData()
    fd.append('image', dataUrlToFile(dataUrl, safe))
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`upload ${res.status}`)
    return (await res.json())?.name || safe
  }

  return { busy, error, results, fluxFill, kontext, segment, text2img, uploadDataUrl }
}
