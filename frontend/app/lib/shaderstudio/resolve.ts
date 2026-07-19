// frontend/app/lib/shaderstudio/resolve.ts
// Resolve a Shader Studio node's input to ONE uniform shape, so the node card and
// the modal share identical source semantics instead of each re-deriving them
// (these two surfaces have drifted before).
//
// Priority: live upstream studio → artifact file → the node's own config source.
// The artifact path is unchanged; it is now one branch rather than the only one.

import { resolveWiredInput } from '~/lib/shaderstudio/source'
import { getStudioFrameSource, type StudioFrameSource } from '~/lib/studio/frameSource'

/** A source normalized so callers never branch on where the pixels came from. */
export interface ResolvedSource {
  getFrame: (t01: number, w: number, h: number) => Promise<TexImageSource>
  width: number
  height: number
  /** Natural clock in seconds; 0 means still. */
  duration: number
  fps: number
  /** True when backed by a live upstream studio rather than a loaded file. */
  isLive: boolean
}

export type SourceKind =
  | { kind: 'live'; source: StudioFrameSource }
  | { kind: 'url'; url: string }

/**
 * Descriptor for whatever is wired into `nodeId`'s input-0, or null.
 *
 * Returns a descriptor rather than a ResolvedSource because the `url` case needs
 * to load an image (DOM), while this resolution logic must stay pure so it can be
 * unit-tested in a node environment.
 */
export function resolveSourceKind(nodeId: string, nodes: any[], edges: any[]): SourceKind | null {
  const edge = edges.find((e: any) => String(e.target) === String(nodeId) && e.targetHandle === 'input-0')
  if (edge) {
    // A live upstream studio wins: it renders at any size and any time, so it is
    // strictly better than that studio's last baked file.
    const live = getStudioFrameSource(String(edge.source))
    if (live) return { kind: 'live', source: live }
  }
  // No live source (unmounted studio, or a plain artifact node) — fall through to
  // the existing file resolution, which also handles LoadImage / Image artifacts.
  const url = resolveWiredInput(nodeId, nodes, edges)
  return url ? { kind: 'url', url } : null
}

export function makeLiveSource(src: StudioFrameSource): ResolvedSource {
  return {
    getFrame: (t01, w, h) => src.getFrame(t01, w, h),
    width: src.width,
    height: src.height,
    duration: src.duration,
    fps: src.fps,
    isLive: true,
  }
}

/** Wrap an already-loaded image as a zero-duration source. */
export function makeImageSource(img: { naturalWidth: number; naturalHeight: number }): ResolvedSource {
  return {
    getFrame: async () => img as unknown as TexImageSource,
    width: img.naturalWidth,
    height: img.naturalHeight,
    duration: 0,
    fps: 0,
    isLive: false,
  }
}

/**
 * Whoever supplies the frames owns the clock. An animated source overrides the
 * consumer's own motion settings; a still source leaves them in charge.
 */
export function exportClock(
  resolved: ResolvedSource | null,
  ownDuration: number,
  ownFps: number,
): { duration: number; fps: number } {
  // Same `duration > 0` rule as isAnimatedSource, applied to the resolved shape.
  if (resolved && resolved.duration > 0) {
    return { duration: resolved.duration, fps: resolved.fps }
  }
  return { duration: ownDuration, fps: ownFps }
}

/**
 * Return `cfg` with `motion.duration` replaced by the governing clock.
 *
 * `applyMotion` divides by `cfg.motion.duration` internally
 * (`frontend/app/lib/shaderstudio/motion.ts:72`). Feeding it absolute seconds
 * derived from a DIFFERENT clock — an upstream source's — would run every track
 * at the wrong rate: a 6s upstream against a 4s config completes 1.5 ramps
 * instead of the one the spec requires. Always route config through this before
 * calling applyMotion with an upstream-derived time.
 */
export function motionConfigFor<T extends { motion: { duration: number } }>(cfg: T, duration: number): T {
  return { ...cfg, motion: { ...cfg.motion, duration } }
}
