/**
 * Client-side motion bake: render the full layer stack at every frame time to
 * an offscreen canvas, collect PNG blobs (alpha preserved), upload via the
 * existing /upload/image batch helper, and produce the motion_params payload
 * the Compositor backend node consumes.
 */
import type { LocalLayer, StackItem } from '~/composables/useCompositorLayers'
import {
  paintLayerStack, ensureLayerFonts, ensureLayerImages,
} from '~/composables/useCompositorLayers'
import './paint' // ensure the motion painter is registered
import { uploadFrameBatch } from '~/composables/useKineticRenderer'
import type { FrameMotion } from './types'

/** FNV-1a over the JSON of everything that affects baked pixels. */
export function motionSourceKey(
  localLayers: LocalLayer[],
  motion: FrameMotion,
  W: number,
  H: number,
): string {
  const s = JSON.stringify({ localLayers, motion, W, H })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export interface MotionParams {
  fps: number
  duration: number
  rendered: string[]   // uploaded input/ filenames, frame order
  source_key: string
}

export async function bakeMotionFrames(
  buildItems: () => StackItem[],
  localLayers: LocalLayer[],
  W: number,
  H: number,
  motion: FrameMotion,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  await ensureLayerFonts(localLayers, W)
  await ensureLayerImages(localLayers)
  const total = Math.max(1, Math.round(motion.duration * motion.fps))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    const t = i / motion.fps
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height) // transparent background
    paintLayerStack(ctx, canvas.width, canvas.height, buildItems(), localLayers, undefined, t, motion)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error(`motion bake: frame ${i} produced no blob`)
    blobs.push(blob)
    onProgress?.(i + 1, total)
  }
  return blobs
}

export async function bakeAndUpload(
  buildItems: () => StackItem[],
  localLayers: LocalLayer[],
  W: number,
  H: number,
  motion: FrameMotion,
  onProgress?: (done: number, total: number) => void,
): Promise<MotionParams> {
  const blobs = await bakeMotionFrames(buildItems, localLayers, W, H, motion, onProgress)
  const rendered = await uploadFrameBatch(blobs, 'slate')
  if (rendered.length !== blobs.length) {
    throw new Error(`motion bake: uploaded ${rendered.length}/${blobs.length} frames — retry`)
  }
  return {
    fps: motion.fps,
    duration: motion.duration,
    rendered,
    source_key: motionSourceKey(localLayers, motion, W, H),
  }
}
