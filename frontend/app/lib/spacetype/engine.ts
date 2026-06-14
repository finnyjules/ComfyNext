import * as THREE from 'three'
import type { Params, SpaceTypeEffect } from './effect'
import type { TextTextureOptions } from './textTexture'
import { makeTextTexture } from './textTexture'

export interface EngineOptions {
  effect: SpaceTypeEffect
  width: number
  height: number
  fps: number
  loopDuration: number
  alpha: boolean
  bgColor: string
}

export class SpaceTypeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  private effect: SpaceTypeEffect
  private root: THREE.Object3D | null = null
  private textTex: THREE.Texture | null = null
  private opts: EngineOptions

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.opts = opts
    this.effect = opts.effect
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(opts.width, opts.height, false)
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(45, opts.width / opts.height, 0.1, 100)
    this.camera.position.set(0, 0, 14)
    this.applyBackground()
  }

  /** Apply opaque-bg vs transparent based on opts.alpha. Renderer is always
   *  constructed with alpha:true; transparency is a render-time clear setting. */
  private applyBackground(): void {
    if (this.opts.alpha) {
      this.scene.background = null
      this.renderer.setClearColor(0x000000, 0)
    } else {
      const c = new THREE.Color(this.opts.bgColor)
      this.scene.background = c
      this.renderer.setClearColor(c, 1)
    }
  }

  /** Toggle transparency / background color live without rebuilding the renderer. */
  setBackground(alpha: boolean, bgColor: string): void {
    this.opts.alpha = alpha
    this.opts.bgColor = bgColor
    this.applyBackground()
  }

  /** Update loop length so frameCount reflects edits made after construction. */
  setLoopDuration(loopDuration: number): void {
    this.opts.loopDuration = loopDuration
  }

  private disposeRoot(): void {
    if (!this.root) return
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        mesh.geometry?.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat?.dispose()
      }
      const tex = obj.userData?.tex as THREE.Texture | undefined
      if (tex && typeof tex.dispose === 'function') tex.dispose()
    })
    this.scene.remove(this.root)
    this.root = null
    const grad = this.textTex?.userData?.gradient as THREE.Texture | undefined
    grad?.dispose?.()
    this.textTex?.dispose()
    this.textTex = null
  }

  /** (Re)build the scene from params; call when structural params change. */
  build(params: Params, texOpts: TextTextureOptions): void {
    this.disposeRoot()
    const tex = makeTextTexture(texOpts)
    this.textTex = tex
    this.root = this.effect.buildScene(THREE, params, tex)
    this.scene.add(this.root)
  }

  /** Total frames in one loop. */
  get frameCount(): number { return Math.max(1, Math.round(this.opts.fps * this.opts.loopDuration)) }

  /** Render the scene at integer frame index. t01 = index / frameCount (no wall clock). */
  renderFrame(index: number, params: Params): void {
    const t01 = (index % this.frameCount) / this.frameCount
    this.scene.rotation.set(Number(params.rotateX ?? 0), Number(params.rotateY ?? 0), Number(params.rotateZ ?? 0))
    const scale = Number(params.scale ?? 1) || 1
    this.camera.position.z = 14 / scale
    this.effect.update(t01, params)
    this.renderer.render(this.scene, this.camera)
  }

  /** Read the current canvas back as a PNG blob (after renderFrame). */
  async frameToBlob(): Promise<Blob> {
    const canvas = this.renderer.domElement
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('space type: frame produced no blob')
    return blob
  }

  dispose(): void {
    this.disposeRoot()
    this.renderer.dispose()
  }
}
