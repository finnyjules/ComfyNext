/**
 * Outpaint an image to a target aspect ratio and hand back a ComfyUI `/view`
 * URL for the extended result. Ties the pure planner (plan.ts) + browser
 * compositor (compose.ts) to the existing FLUX Fill + upload rails in
 * useInpaint. Automatic (empty prompt): the model continues the background
 * outward. Any failure throws and leaves the caller's element untouched — the
 * URL is only returned after the full pipeline succeeds.
 */
import { ref } from 'vue'
import { useInpaint, loadImage } from '~/composables/useInpaint'
import { planOutpaint } from '~/lib/outpaint/plan'
import { composeOutpaint } from '~/lib/outpaint/compose'

export function useOutpaintFit() {
  const inpaint = useInpaint()
  const busy = ref(false)
  const error = ref('')

  /**
   * @param srcUrl        loadable image URL (http or /view path)
   * @param targetAspect  desired w/h (e.g. 1920/1080 for a Wide format)
   * @returns a `/view?filename=…&type=input` URL for the outpainted image
   */
  async function run(srcUrl: string, targetAspect: number): Promise<string> {
    busy.value = true
    error.value = ''
    try {
      const img = await loadImage(srcUrl)
      const plan = planOutpaint(img.naturalWidth || 1, img.naturalHeight || 1, targetAspect)
      const { image, mask } = composeOutpaint(img, plan)
      const [out] = await inpaint.fluxFill(image, mask, '')
      if (!out) throw new Error('Outpaint returned no image')
      const filename = await inpaint.uploadDataUrl(out, 'outpaint')
      return `/view?filename=${encodeURIComponent(filename)}&type=input`
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Outpaint failed'
      throw err
    } finally {
      busy.value = false
    }
  }

  return { busy, error, run }
}
