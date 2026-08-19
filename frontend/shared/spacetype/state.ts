// frontend/shared/spacetype/state.ts
/** Space Type types that cross the serialization boundary.
 *
 *  These live in shared/ (not app/) because SpaceTypeClip.state is part of
 *  EditState, which is sent to the Python renderer as JSON. shared/ must never
 *  import from app/ — that invariant holds across this whole directory and the
 *  Nitro build is already fragile here.
 *
 *  All three types are plain structural data. Nothing from three.js belongs in
 *  this file, ever. */

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export interface PostSettings {
  bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number
  color: boolean; exposure: number; contrast: number; saturation: number; hue: number
  chroma: boolean; chromaAmount: number
  blur: boolean; blurAmount: number
  distort: boolean; distortAmount: number
  film: boolean; filmIntensity: number; filmGrayscale: boolean
  halftone: boolean; halftoneRadius: number; halftoneScatter: number
  dotScreen: boolean; dotScreenScale: number; dotScreenAngle: number
  glitch: boolean
  grain: boolean; grainAmount: number; grainSize: number
  vignette: boolean; vignetteAmount: number; vignetteRadius: number; vignetteSoftness: number
  duotone: boolean; duotoneShadow: string; duotoneHighlight: string; duotoneMix: number
  gtao: boolean; gtaoRadius: number; gtaoIntensity: number; gtaoThickness: number
}

export interface SpaceTypeState {
  effectId: string
  params: Params
  gradientStops: { color: string; on: boolean }[]
  fps: number
  loopDuration: number
  /** Seamless-loop toggle. When true the true loop length is loopDuration × k
   *  (k = whole-cycle multiplier for the effect's motion). Absent ⇒ false ⇒ base. */
  seamless?: boolean
  dimsKey: string
  transparent: boolean
  bgColor: string
  post?: PostSettings
  projection?: 'perspective' | 'isometric'
  panX?: number
  panY?: number
  /** Explicit pixel dims, saved alongside dimsKey by the editor. When dimsKey
   *  is 'Custom' these are the ONLY record of the real size — resolve dims via
   *  dimsFromState (app/lib/spacetype/state.ts), never dimsFromKey alone. */
  W?: number
  H?: number
}
