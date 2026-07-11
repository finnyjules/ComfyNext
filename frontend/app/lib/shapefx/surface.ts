import * as THREE from 'three'
import { fillTexture } from '../spacetype/fills'
import { DEFAULT_FILL, type Fill } from '../spacetype/fillTile'
import type { ShapeConfig } from './config'

/** Map the studio's SurfaceFill onto the Type Studio Fill shape. */
function toFill(config: ShapeConfig): Fill {
  return {
    ...DEFAULT_FILL,
    type: config.fill.type,
    a: config.fill.a,
    b: config.fill.b,
    textColor: config.fill.a,
    angle: config.fill.angle,
    density: config.fill.density,
  }
}

/**
 * Texture for Surface fill mode. Returns null for a flat solid (caller applies fill.a as a flat
 * material color). Reuses Type Studio's cached fill builder. Texture wraps/repeats across the shape.
 */
export function buildSurfaceTexture(config: ShapeConfig): THREE.Texture | null {
  const fill = toFill(config)
  if (fill.type === 'solid') return null
  const tex = fillTexture(THREE, fill)
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
  }
  return tex
}
