// frontend/app/lib/shaderstudio/resolve.ts
// Resolve a Shader Studio node's input to ONE uniform shape, so the node card and
// the modal share identical source semantics instead of each re-deriving them
// (these two surfaces have drifted before).
//
// Priority: live upstream studio → artifact file → the node's own config source.
// The artifact path is unchanged; it is now one branch rather than the only one.

import { resolveWiredSourceKind } from '~/lib/studio/frameResolve'
import type { StudioFrameSource } from '~/lib/studio/frameSource'

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
  // Delegates to the shared studio-aware resolver (the single copy the Frame uses
  // too). Shader input is always input-0; live upstream studio wins over a baked URL.
  return resolveWiredSourceKind(nodeId, 'input-0', nodes, edges)
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

// motionConfigFor lives in ./motion, not here: that module is Vue-free and the
// shader embed adapter needs it too. Re-exported so existing callers of
// resolve.ts (ShaderStudioNode.vue, ShaderStudioSurface.vue) are unaffected.
export { motionConfigFor } from './motion'
