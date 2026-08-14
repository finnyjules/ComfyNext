import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import type { DecalContent, DecalObject, Vec3 } from './config'
import { parseGoogleFontValue } from './outlines'
import { quickGoogleCssUrl } from '~/data/google-fonts'

/** Projector orientation for a decal: +Z looks along the outward surface
 *  normal. Built with Quaternion.setFromUnitVectors(+Z, normal) rather than
 *  Object3D.lookAt: lookAt's Matrix4 path cross-products the target against a
 *  fixed up vector (0,1,0) and, when the normal IS (0,1,0) (a decal on a
 *  target's top face), that cross product is degenerate — three nudges it by
 *  0.0001 internally, which round-trips through Euler with ~1e-4 error and
 *  fails a tight recover-the-normal check. setFromUnitVectors has no such
 *  vertical-normal blind spot (its only degenerate case, normal = -Z, has an
 *  exact closed-form branch), so every direction round-trips to double
 *  precision. */
export function eulerFromNormal(localNormal: Vec3): Vec3 {
  const n = new THREE.Vector3(...localNormal).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
  return [e.x, e.y, e.z]
}

/** Rebuild key. Opacity is deliberately absent — the engine writes it to the
 *  material in place so the slider never re-projects geometry. */
export function decalKeyFor(obj: DecalObject, targetGeoKey: unknown): string {
  return JSON.stringify([obj.content, obj.position, obj.rotation, obj.spin, obj.size, obj.depth, targetGeoKey ?? null])
}

// One texture per distinct content, shared across decals and rebuilds. The
// engine must therefore NEVER dispose a decal texture — dispose geometry and
// material only (Material.dispose does not dispose .map).
const texCache = new Map<string, Promise<THREE.Texture>>()

export function decalTextureFor(content: DecalContent): Promise<THREE.Texture> {
  const key = JSON.stringify(content)
  let p = texCache.get(key)
  if (!p) {
    p = content.type === 'image' ? loadImageTexture(content.image) : makeTextDecalTexture(content)
    texCache.set(key, p)
    p.catch(() => texCache.delete(key)) // evict failures so the next sync retries
  }
  return p
}

function loadImageTexture(filename: string): Promise<THREE.Texture> {
  const url = `/view?${new URLSearchParams({ filename, type: 'input' }).toString()}`
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  })
}

// Reuses outlines.ts's parseGoogleFontValue for the `google:Fam@W` token
// (it already handles a missing/malformed weight suffix); a non-google font
// value or a parse miss falls back to Inter/700, matching the DECAL_DEFAULTS
// font.
function parseFontToken(font: string): { family: string; weight: number } {
  const parsed = parseGoogleFontValue(font)
  if (parsed) return { family: parsed.family, weight: parsed.weight ?? 700 }
  return { family: 'Inter', weight: 700 }
}

async function ensureCanvasFont(family: string, weight: number): Promise<void> {
  const id = `scene3d-decal-font-${family.replace(/\s+/g, '-')}-${weight}`
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    // Reuses google-fonts.ts's quickGoogleCssUrl — same css2 URL shape this
    // module would otherwise build inline.
    link.href = quickGoogleCssUrl(family, weight)
    document.head.appendChild(link)
  }
  try { await document.fonts.load(`${weight} 64px "${family}"`) } catch { /* canvas falls back to sans-serif */ }
}

async function makeTextDecalTexture(content: Extract<DecalContent, { type: 'text' }>): Promise<THREE.Texture> {
  const { family, weight } = parseFontToken(content.font)
  await ensureCanvasFont(family, weight)
  const pad = 32, fontPx = 192
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `${weight} ${fontPx}px "${family}", sans-serif`
  const w = Math.max(2, Math.ceil(measure.measureText(content.text || ' ').width)) + pad * 2
  const h = fontPx + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.font = `${weight} ${fontPx}px "${family}", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = content.color
  ctx.fillText(content.text || ' ', w / 2, h / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Build the decal mesh in TARGET-LOCAL space: DecalGeometry reads the given
 *  mesh's matrixWorld, so projecting against a proxy that shares the target's
 *  geometry but sits at identity yields local-space output. The engine adds
 *  the result under the target's root with an identity transform. */
export function buildDecalMesh(targetMesh: THREE.Mesh, obj: DecalObject, texture: THREE.Texture): THREE.Mesh {
  const img = texture.image as { width?: number; height?: number } | undefined
  const aspect = img?.width && img?.height ? img.width / img.height : 1
  const proxy = new THREE.Mesh(targetMesh.geometry)
  proxy.updateMatrixWorld(true) // identity ⇒ local-space projection
  const helper = new THREE.Object3D()
  helper.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2])
  helper.rotateZ(obj.spin)
  const size = new THREE.Vector3(obj.size, obj.size / aspect, obj.depth)
  const geo = new DecalGeometry(proxy, new THREE.Vector3(...obj.position), helper.rotation, size)
  const mat = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, opacity: obj.opacity,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    roughness: 0.7, metalness: 0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}
