/**
 * In-place AI edits on Frame image layers (Cut out subject, Harmonize).
 * Loads the layer's bitmap from ComfyUI's input dir, runs a cloud edit, uploads
 * the result and swaps the layer's `filename` via the editor's setLocal — which
 * records exactly one undo step. The swap happens only after the FULL pipeline
 * succeeds: any failure leaves the layer untouched.
 */
import { ref } from 'vue'
import { useInpaint } from '~/composables/useInpaint'
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

  /** The layer's source bitmap as a PNG data URL (from ComfyUI's input dir). */
  async function layerImageDataUrl(filename: string): Promise<string> {
    const img = await loadImageEl(`/view?${new URLSearchParams({ filename, type: 'input' })}`)
    const c = document.createElement('canvas')
    c.width = img.naturalWidth || 1
    c.height = img.naturalHeight || 1
    c.getContext('2d')!.drawImage(img, 0, 0)
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

  return { busy, error, layerImageDataUrl, cutOutLayer }
}
