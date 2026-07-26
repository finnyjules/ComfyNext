import * as THREE from 'three'
import { fillTexture } from '../spacetype/fills'
import { DEFAULT_FILL, fillIsShader, type Fill } from '../spacetype/fillTile'
import type { ShapeConfig } from './config'

/** Map the studio's SurfaceFill onto the Type Studio Fill shape. Includes `shader` — dropping
 *  it here was the actual reason a Shape Studio fill picked as "shader" never rendered the
 *  live field (see SurfaceFill.shader's doc in config.ts): `fillIsShader`/`fillTexture` both
 *  key off `fill.shader` being present, and this function is the one place that maps
 *  `ShapeConfig`'s fill onto the `Fill` shape they read. */
function toFill(config: ShapeConfig): Fill {
  return {
    ...DEFAULT_FILL,
    type: config.fill.type,
    a: config.fill.a,
    b: config.fill.b,
    textColor: config.fill.a,
    angle: config.fill.angle,
    density: config.fill.density,
    shader: config.fill.shader,
  }
}

/** True when `config`'s current fill is a real, renderable shader fill (surface mode, type
 *  `shader`, and an actual `ShaderSpec` attached — not just the bare type with nothing to
 *  render yet). Exported so callers with a per-frame loop (ShapeStudioSurface.vue) can gate
 *  the shader-field refresh call on it, rather than paying that per-frame cost for every open
 *  Shape Studio node regardless of whether it uses a shader fill at all. */
export function configHasShaderFill(config: ShapeConfig): boolean {
  return config.fillMode === 'surface' && fillIsShader(toFill(config))
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
