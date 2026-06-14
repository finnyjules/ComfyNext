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
  private opts: EngineOptions

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.opts = opts
    this.effect = opts.effect
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: opts.alpha, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(opts.width, opts.height, false)
    this.scene = new THREE.Scene()
    if (!opts.alpha) this.scene.background = new THREE.Color(opts.bgColor)
    this.camera = new THREE.PerspectiveCamera(45, opts.width / opts.height, 0.1, 100)
    this.camera.position.set(0, 0, 14)
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
  }

  /** (Re)build the scene from params; call when structural params change. */
  build(params: Params, texOpts: TextTextureOptions): void {
    this.disposeRoot()
    const tex = makeTextTexture(texOpts)
    this.root = this.effect.buildScene(THREE, params, tex)
    this.scene.add(this.root)
  }

  /** Total frames in one loop. */
  get frameCount(): number { return Math.max(1, Math.round(this.opts.fps * this.opts.loopDuration)) }

  /** Render the scene at integer frame index. t01 = index / frameCount (no wall clock). */
  renderFrame(index: number, params: Params): void {
    const t01 = (index % this.frameCount) / this.frameCount
    this.camera.rotation.x = Number(params.cameraTilt ?? 0)
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
