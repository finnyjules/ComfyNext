/**
 * In-place AI edits on Frame image layers (Cut out subject, Harmonize).
 * Loads the layer's bitmap from ComfyUI's input dir, runs a cloud edit, uploads
 * the result and swaps the layer's `filename` via the editor's setLocal — which
 * records exactly one undo step. The swap happens only after the FULL pipeline
 * succeeds: any failure leaves the layer untouched.
 */
import { ref } from 'vue'
import { useInpaint, capDims } from '~/composables/useInpaint'
import { HARMONIZE_PROMPT } from '~/lib/editActions/prompts'
import type { ImageLayer } from '~/composables/useCompositorLayers'

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}

export function useLayerImageEdit() {
  const inpaint = useInpaint()
  const busy = ref(false)
  const error = ref('')

  /** The layer's source bitmap as a PNG data URL (from ComfyUI's input dir).
   *  Capped to a 1536px longest side before it ever hits a paid Replicate
   *  endpoint (house rule: cost-conscious AI) — mirrors CompositorModal's
   *  `capDims` cap on the old pre-Task-8 code path. */
  async function layerImageDataUrl(filename: string): Promise<string> {
    const img = await loadImageEl(`/view?${new URLSearchParams({ filename, type: 'input' })}`)
    const { w, h } = capDims(img.naturalWidth || 1, img.naturalHeight || 1)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    return c.toDataURL('image/png')
  }

  /** Replace the layer's content with its background-removed cutout. */
  async function cutOutLayer(layer: ImageLayer, setLocal: (id: string, patch: Record<string, any>) => void): Promise<void> {
    if (busy.value) return
    busy.value = true; error.value = ''
    try {
      const source = await layerImageDataUrl(layer.filename)
      const cutout = await inpaint.removeBackground(source)
      const filename = await inpaint.uploadDataUrl(cutout, `cutout_${layer.id}`)
      setLocal(layer.id, { filename })
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Cut out failed'
    } finally {
      busy.value = false
    }
  }

  /** Relight + color-match a layer to the scene around it, in place.
   *  renderScene: surface-supplied full-composite render (wired + local). */
  async function harmonizeLayer(
    layer: ImageLayer,
    setLocal: (id: string, patch: Record<string, any>) => void,
    renderScene: () => { canvas: HTMLCanvasElement; W: number; H: number },
  ): Promise<void> {
    if (busy.value) return
    busy.value = true; error.value = ''
    try {
      const { canvas, W, H } = renderScene()
      // Layer bbox in scene pixels — note w AND h are normalized to canvas WIDTH.
      const pxW = layer.w * W, pxH = layer.h * W
      const pad = 0.4
      const cx = layer.x * W, cy = layer.y * H
      const x0 = Math.max(0, Math.round(cx - (pxW * (1 + pad)) / 2))
      const y0 = Math.max(0, Math.round(cy - (pxH * (1 + pad)) / 2))
      const x1 = Math.min(W, Math.round(cx + (pxW * (1 + pad)) / 2))
      const y1 = Math.min(H, Math.round(cy + (pxH * (1 + pad)) / 2))
      if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error('Layer is too small to harmonize')
      const crop = document.createElement('canvas')
      crop.width = x1 - x0
      crop.height = y1 - y0
      crop.getContext('2d')!.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
      const sceneCrop = crop.toDataURL('image/png')

      const layerImg = await layerImageDataUrl(layer.filename)
      // Order is load-bearing: [0] = scene context, [1] = the object to relight.
      const results = await inpaint.nanoGen(HARMONIZE_PROMPT, undefined, [sceneCrop, layerImg])
      const harmonized = results[0]
      if (!harmonized) throw new Error('Harmonize returned no image')
      // Recover the alpha cutout (nano-banana returns an opaque image).
      const cutout = await inpaint.removeBackground(harmonized)
      const filename = await inpaint.uploadDataUrl(cutout, `harmonize_${layer.id}`)
      setLocal(layer.id, { filename })
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Harmonize failed'
    } finally {
      busy.value = false
    }
  }

  return { busy, error, layerImageDataUrl, cutOutLayer, harmonizeLayer }
}
