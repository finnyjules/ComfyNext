import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import type { DecalBlend, DecalContent, DecalObject, Vec3 } from './config'
import { parseGoogleFontValue, parseLibraryFontValue, fontSourceUrl } from './outlines'
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
 *  material in place so the slider never re-projects geometry. `blend` IS present:
 *  it reconfigures the material's blending (and, for multiply/screen, its shader),
 *  which buildDecalMesh applies once at build — a discrete select, not a drag, so a
 *  rebuild per change is fine. */
export function decalKeyFor(obj: DecalObject, targetGeoKey: unknown): string {
  return JSON.stringify([obj.content, obj.position, obj.rotation, obj.spin, obj.size, obj.depth, obj.blend ?? 'normal', targetGeoKey ?? null])
}

/** Cap on distinct decal contents held in the texture cache. A studio session
 *  that cycles through stickers/wordings would otherwise retain every canvas
 *  and every uploaded image for the life of the page — the cache is
 *  module-level and shared across SceneEngine instances, so nothing else ever
 *  drops them. */
export const DECAL_TEX_CACHE_MAX = 32

/** One texture per distinct content, shared across decals, rebuilds AND
 *  SceneEngine instances (the headless bake engine shares this cache with the
 *  live viewport engine) — so no consumer may dispose a decal texture on its
 *  own. Ownership instead works as: `buildDecalMesh` ACQUIRES for the mesh it
 *  builds, and whoever tears that mesh down RELEASES (the engine's decal branch
 *  when it swaps the old mesh out, `disposeTree` for every other path). The
 *  texture is disposed exactly when both are true — no live mesh references it
 *  AND the cache no longer holds it — so an LRU eviction of a content still
 *  painted on screen is safe: it drops the cache entry now and the GPU texture
 *  later, when the last mesh using it goes away.
 *
 *  Insertion order in `entries` IS the LRU order: a cache hit re-inserts. */
export class DecalTextureRegistry {
  private entries = new Map<string, { promise: Promise<THREE.Texture>; texture: THREE.Texture | null }>()
  /** Textures a live cache entry currently holds — the "don't dispose on release" set. */
  private cached = new Set<THREE.Texture>()
  private refs = new Map<THREE.Texture, number>()

  constructor(private readonly max: number = DECAL_TEX_CACHE_MAX) {}

  get size(): number { return this.entries.size }
  isCached(tex: THREE.Texture): boolean { return this.cached.has(tex) }
  refCount(tex: THREE.Texture): number { return this.refs.get(tex) ?? 0 }

  get(key: string, make: () => Promise<THREE.Texture>): Promise<THREE.Texture> {
    const hit = this.entries.get(key)
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); return hit.promise } // touch (LRU)
    const entry: { promise: Promise<THREE.Texture>; texture: THREE.Texture | null } =
      { promise: undefined as unknown as Promise<THREE.Texture>, texture: null }
    entry.promise = make().then((t) => {
      entry.texture = t
      // Evicted while still loading ⇒ never joins `cached`, so the first
      // release disposes it. Nothing has rendered it yet, so no GPU memory is
      // held in the meantime.
      if (this.entries.get(key) === entry) this.cached.add(t)
      return t
    })
    entry.promise.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key) }) // evict failures so the next sync retries
    this.entries.set(key, entry)
    this.evict()
    return entry.promise
  }

  /** One live mesh now paints with `tex`. */
  acquire(tex: THREE.Texture): void { this.refs.set(tex, this.refCount(tex) + 1) }

  /** One live mesh stopped painting with `tex`. Disposes only once no mesh
   *  references it AND it is not the cache's current texture for its content. */
  release(tex: THREE.Texture): void {
    const n = this.refCount(tex) - 1
    if (n > 0) { this.refs.set(tex, n); return }
    this.refs.delete(tex)
    if (!this.cached.has(tex)) tex.dispose()
  }

  private evict(): void {
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const entry = this.entries.get(oldest.value)!
      this.entries.delete(oldest.value)
      const tex = entry.texture
      if (!tex) continue // still loading — the `.then` above sees it is gone and skips `cached`
      this.cached.delete(tex)
      if (this.refCount(tex) === 0) tex.dispose()
      // else: still painted somewhere. `release` disposes it when the last
      // mesh drops, because it is no longer in `cached`.
    }
  }
}

export const decalTextures = new DecalTextureRegistry()

/** Cache key for a decal content — also the key the engine de-dupes its
 *  load-failure warning by. */
export function decalContentKey(content: DecalContent): string { return JSON.stringify(content) }

export function decalTextureFor(content: DecalContent): Promise<THREE.Texture> {
  return decalTextures.get(decalContentKey(content), () => (
    content.type === 'image' ? loadImageTexture(content.image) : makeTextDecalTexture(content)
  ))
}

/** Release the texture a torn-down decal mesh was painting with — see
 *  `DecalTextureRegistry`'s doc for the ownership rules. Takes the mesh's
 *  `userData.decalTexture` (nullable so callers need no guard of their own). */
export function releaseDecalTexture(tex: THREE.Texture | null | undefined): void {
  if (tex) decalTextures.release(tex)
}

function loadImageTexture(filename: string): Promise<THREE.Texture> {
  const url = `/view?${new URLSearchParams({ filename, type: 'input' }).toString()}`
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  })
}

/** How a decal label's font token reaches the 2D canvas. Two routes:
 *  - `google` — inject the css2 stylesheet and draw with the real family name
 *    (weight matters: css2 serves per-weight faces).
 *  - `file` — a font FILE the browser knows nothing about (a `local:` Pangram
 *    library token resolved to `/api/library-font/<id>`, or a pinned
 *    AVAILABLE_FONTS url). Registered via `FontFace` under a synthetic
 *    `cssFamily` derived from the token — synthetic because the file IS one
 *    concrete face; drawing it under its real family name at weight 400 could
 *    collide with a same-named css2 registration, and drawing at the token's
 *    weight would make the canvas synthetically re-bold an already-bold file.
 *  Anything unresolvable (library token with no resolver/unknown family,
 *  garbage) falls back to Inter/700, matching DECAL_DEFAULTS.font. Pure —
 *  vitest covers the routing; only ensureCanvasFont/ensureFileFont touch the DOM. */
export function canvasFontPlanFor(font: string):
  | { kind: 'google'; family: string; weight: number }
  | { kind: 'file'; cssFamily: string; url: string } {
  const google = parseGoogleFontValue(font)
  if (google) return { kind: 'google', family: google.family, weight: google.weight ?? 700 }
  const lib = parseLibraryFontValue(font)
  if (lib) {
    const url = fontSourceUrl(font)
    // fontSourceUrl echoes the token back when the library resolver isn't
    // installed or doesn't know the family — that's the fall-back signal.
    if (url !== font) return { kind: 'file', cssFamily: sanitizeCssFamily(font), url }
    return { kind: 'google', family: 'Inter', weight: 700 }
  }
  // Pinned AVAILABLE_FONTS entries are plain font-file urls.
  if (font.startsWith('/') || font.startsWith('http')) {
    return { kind: 'file', cssFamily: sanitizeCssFamily(font), url: font }
  }
  return { kind: 'google', family: 'Inter', weight: 700 }
}

function sanitizeCssFamily(token: string): string {
  return `decal-${token.replace(/^local:/, 'local_').replace(/[^A-Za-z0-9_-]+/g, '_')}`
}

// One FontFace registration per cssFamily, shared for the page's lifetime.
// Failures evict so a transient 404 (e.g. library catalog still loading)
// retries on the next label render instead of caching the miss forever.
const fileFontLoads = new Map<string, Promise<void>>()
async function ensureFileFont(cssFamily: string, url: string): Promise<void> {
  let p = fileFontLoads.get(cssFamily)
  if (!p) {
    const face = new FontFace(cssFamily, `url("${url}")`)
    p = face.load().then((loaded) => { document.fonts.add(loaded) })
    fileFontLoads.set(cssFamily, p)
    p.catch(() => fileFontLoads.delete(cssFamily))
  }
  return p
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
  const plan = canvasFontPlanFor(content.font)
  let family: string
  let weight: number
  if (plan.kind === 'file') {
    family = plan.cssFamily
    weight = 400 // the file carries its real weight — 400 avoids synthetic bolding
    try {
      await ensureFileFont(plan.cssFamily, plan.url)
    } catch {
      // Unfetchable/unparseable file: draw with the default instead of tofu.
      family = 'Inter'; weight = 700
      await ensureCanvasFont(family, weight)
    }
  } else {
    family = plan.family
    weight = plan.weight
    await ensureCanvasFont(family, weight)
  }
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

/** GPU-native blend recipes, keyed by mode. Every one of these is a fixed hardware blend
 *  equation over (src, dst) — the whole family the framebuffer can do WITHOUT the shader
 *  reading the surface underneath. `normal`/`add` respect the glyph's ALPHA on their own.
 *  `multiply`/`screen`/`darken`/`lighten` read src COLOR (or run min/max), so a naive pass
 *  would turn the transparent border around the glyphs into a solid box — the `identity`
 *  field is the fix: the fragment premultiplies the (lit, tone-mapped) colour toward that
 *  value by the pixel's alpha (`mix(identity, colour, a)`) and forces output alpha to 1, so
 *  the border (a=0) lands exactly on the mode's no-op and only the glyph blends. Opacity
 *  still fades (the mixed `a` = diffuseColor.a = map alpha × material.opacity). Alpha
 *  factors/equation are chosen to leave the FRAMEBUFFER's own alpha intact (dst.a), so a
 *  transparent-background export gets no rectangular patch where the projector box sat.
 *
 *  The non-linear Photoshop family (soft-light, overlay, hard-light, dodge, burn, …) is
 *  deliberately absent: those are functions of BOTH src and dst that no blend equation can
 *  express, so they need the shader to sample the surface beneath (a framebuffer grab) —
 *  a separate, bigger mechanism, not this table. */
interface BlendRecipe {
  blending: THREE.Blending
  equation?: THREE.BlendingEquation
  equationAlpha?: THREE.BlendingEquation
  src?: THREE.BlendingDstFactor; dst?: THREE.BlendingDstFactor
  srcAlpha?: THREE.BlendingDstFactor; dstAlpha?: THREE.BlendingDstFactor
  identity?: number // present ⇒ inject the premultiply-toward-identity patch
}

const BLEND_RECIPES: Record<DecalBlend, BlendRecipe> = {
  normal: { blending: THREE.NormalBlending },
  add: { blending: THREE.AdditiveBlending },
  // dst·src, alpha dst·src.a — src.a forced to 1 keeps dst.a.
  multiply: { blending: THREE.MultiplyBlending, identity: 1 },
  // src + dst·(1−src) = screen; Zero/One alpha keeps dst.a.
  screen: {
    blending: THREE.CustomBlending, equation: THREE.AddEquation,
    src: THREE.OneFactor, dst: THREE.OneMinusSrcColorFactor,
    srcAlpha: THREE.ZeroFactor, dstAlpha: THREE.OneFactor, identity: 0,
  },
  // min(src, dst) on colour; MIN on alpha with src.a=1 → min(1,dst.a)=dst.a preserved.
  darken: {
    blending: THREE.CustomBlending, equation: THREE.MinEquation,
    equationAlpha: THREE.MinEquation, identity: 1,
  },
  // max(src, dst) on colour; MIN on alpha (not MAX) so the border doesn't stamp dst.a→1.
  lighten: {
    blending: THREE.CustomBlending, equation: THREE.MaxEquation,
    equationAlpha: THREE.MinEquation, identity: 0,
  },
}

/** Configure a decal material's framebuffer blend from BLEND_RECIPES (see its doc). */
function applyDecalBlend(mat: THREE.MeshStandardMaterial, blend: DecalBlend): void {
  const r = BLEND_RECIPES[blend] ?? BLEND_RECIPES.normal
  mat.blending = r.blending
  if (r.blending === THREE.CustomBlending) {
    if (r.equation !== undefined) mat.blendEquation = r.equation
    if (r.equationAlpha !== undefined) mat.blendEquationAlpha = r.equationAlpha
    if (r.src !== undefined) mat.blendSrc = r.src
    if (r.dst !== undefined) mat.blendDst = r.dst
    if (r.srcAlpha !== undefined) mat.blendSrcAlpha = r.srcAlpha
    if (r.dstAlpha !== undefined) mat.blendDstAlpha = r.dstAlpha
  }
  if (r.identity === undefined) return
  const identity = r.identity.toFixed(1)
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <colorspace_fragment>',
      `#include <colorspace_fragment>\n\tgl_FragColor = vec4( mix( vec3( ${identity} ), gl_FragColor.rgb, gl_FragColor.a ), 1.0 );`,
    )
  }
  // three keys compiled programs BEFORE running onBeforeCompile, so without this two
  // materials whose only difference is the injected identity would share one program.
  mat.customProgramCacheKey = () => `decal-blend-${blend}`
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
  // The engine adds this mesh at identity UNDER the target root, so it inherits the
  // target's (often non-uniform) world scale — a unit BoxGeometry scaled into a flat
  // wide card is the common case. DecalGeometry projects in the target's LOCAL geometry
  // space, so the aspect correction below (`obj.size / aspect` on Y) is undone by that
  // parent scale and the glyphs stretch. Compensate: divide each projector axis by the
  // world-scale magnitude ALONG that axis, so once the parent re-applies its scale the
  // on-surface size is aspect-correct. Exact for an axis-aligned decal; an obliquely
  // rotated projector on a non-uniform scale degrades gracefully (the per-axis magnitude
  // still tracks the dominant stretch). Depth stays in local space — it already wrapped
  // correctly and normalising it could push the projection box through the far face.
  targetMesh.updateWorldMatrix(true, false)
  const ws = targetMesh.getWorldScale(new THREE.Vector3())
  helper.updateMatrix()
  const axisX = new THREE.Vector3().setFromMatrixColumn(helper.matrix, 0)
  const axisY = new THREE.Vector3().setFromMatrixColumn(helper.matrix, 1)
  const effX = Math.hypot(axisX.x * ws.x, axisX.y * ws.y, axisX.z * ws.z) || 1
  const effY = Math.hypot(axisY.x * ws.x, axisY.y * ws.y, axisY.z * ws.z) || 1
  const size = new THREE.Vector3(obj.size / effX, obj.size / aspect / effY, obj.depth)
  const geo = new DecalGeometry(proxy, new THREE.Vector3(...obj.position), helper.rotation, size)
  const mat = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, opacity: obj.opacity,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    roughness: 0.7, metalness: 0,
  })
  applyDecalBlend(mat, obj.blend ?? 'normal')
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = false
  mesh.receiveShadow = true
  // texture is the shared registry entry, held by every decal that uses this
  // content AND across SceneEngine instances (the headless bake engine shares
  // the cache with the live viewport engine) — so disposing this mesh must
  // free its geometry + material only, never its .map, or it frees a texture
  // other live decals still reference. `sharedMapMaterial` is what makes
  // engine.ts's disposeTree skip the map; `decalTexture` is the handle it
  // (and the engine's own old-mesh swap) release through.
  mesh.userData.sharedMapMaterial = true
  mesh.userData.decalTexture = texture
  decalTextures.acquire(texture)
  return mesh
}
