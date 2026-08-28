/**
 * Per-slot visibility masks for WIRED content, folded into the host's content
 * provider.
 *
 * The legacy `drawWiredImageLayer` took a `maskImg` (white = hidden, in the
 * content's own pixel space) and punched it out of the image before drawing.
 * Once wired slots paint through the generic layer pipeline there is no such
 * argument any more — the mask would just vanish from every frame that has one,
 * which is precisely the "silently drop it" outcome the unification is not
 * allowed to produce.
 *
 * So the mask moves one level down: the host's `slot → content` provider hands
 * back the ALREADY-MASKED surface. Paint stays oblivious, and the mask keeps
 * living on the treatments registry keyed by slot, exactly as it does today.
 *
 * The provider is called on every draw and every box/hit-test resolve, so the
 * masked surface is memoized. Memoization is only safe for a STATIC source: a
 * live studio slot draws new pixels into the same canvas object every frame, so
 * its identity never changes while its content does — those rebuild each call
 * (the same cost the legacy draw path paid, which also rebuilt per draw).
 * Dimensions are identical either way, so the "frame-stable" contract on
 * `_registerWiredContent` still holds: box-sizing and drawing agree.
 */

type Src = CanvasImageSource
type MaskLike = HTMLImageElement | HTMLCanvasElement | null | undefined

function dimsOf(s: any): { w: number; h: number } {
  const w = Number(s?.naturalWidth ?? s?.width ?? 0)
  const h = Number(s?.naturalHeight ?? s?.height ?? 0)
  return { w, h }
}

function maskReady(m: MaskLike): m is HTMLImageElement | HTMLCanvasElement {
  if (!m) return false
  if ('complete' in m && !m.complete) return false
  return dimsOf(m).w > 0 && dimsOf(m).h > 0
}

/** True for a surface whose pixels are redrawn in place (a live studio slot). */
function isMutableSurface(s: Src): boolean {
  return typeof HTMLImageElement === 'undefined' || !(s instanceof HTMLImageElement)
}

export interface WiredMaskCache {
  /** `src` with `mask` punched out, or `src` unchanged when there is no usable mask. */
  apply(slot: number, src: Src | null, mask: MaskLike): Src | null
  /** Drop every memoized surface (unmount / slot rewiring). */
  clear(): void
}

export function createWiredMaskCache(): WiredMaskCache {
  const memo = new Map<number, { src: Src; mask: MaskLike; out: HTMLCanvasElement }>()
  return {
    apply(slot, src, mask) {
      if (!src) return null
      if (!maskReady(mask)) { memo.delete(slot); return src }
      const { w, h } = dimsOf(src)
      if (!(w > 0) || !(h > 0)) return src
      const hit = memo.get(slot)
      if (hit && hit.src === src && hit.mask === mask && !isMutableSurface(src)) return hit.out
      if (typeof document === 'undefined') return src
      const out = hit && hit.out.width === w && hit.out.height === h
        ? hit.out
        : Object.assign(document.createElement('canvas'), { width: w, height: h })
      const ctx = out.getContext('2d')
      if (!ctx) return src
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(src, 0, 0, w, h)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(mask, 0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      memo.set(slot, { src, mask, out })
      return out
    },
    clear() { memo.clear() },
  }
}
