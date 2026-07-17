// frontend/app/lib/scene3d/interaction.ts
// Viewport interaction: orbit camera, click-to-select raycasting, and the
// TransformControls gizmo. Emits document-shaped mutations (TransformSnapshot)
// so the surface owns all SceneDoc writes — a future undo/redo hooks in there.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Vec3 } from './config'
import type { SceneEngine } from './engine'

export type GizmoMode = 'translate' | 'rotate' | 'scale'
export interface TransformSnapshot { position: Vec3; rotation: Vec3; scale: Vec3 }

export class SceneInteraction {
  readonly orbit: OrbitControls
  private gizmo: TransformControls
  private raycaster = new THREE.Raycaster()
  private selectedId: string | null = null
  private downAt: [number, number] | null = null
  // Latched from 'dragging-changed': the gizmo's own pointerup listener runs
  // before ours (registered earlier on the same element) and resets
  // gizmo.dragging, so onUp must consult this latch instead. Set on drag
  // start, consumed (read + cleared) inside onUp — a deferred clear wouldn't
  // survive the microtask checkpoint browsers run between listeners on
  // trusted events.
  private gizmoDragged = false

  constructor(
    private engine: SceneEngine,
    private domElement: HTMLElement,
    private callbacks: {
      onSelect: (id: string | null) => void
      onTransform: (id: string, t: TransformSnapshot) => void
      onCameraChange?: () => void
    },
  ) {
    this.orbit = new OrbitControls(engine.camera, domElement)
    this.orbit.enableDamping = true
    this.orbit.addEventListener('change', () => callbacks.onCameraChange?.())
    this.gizmo = new TransformControls(engine.camera, domElement)
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value
      if (e.value) this.gizmoDragged = true
    })
    this.gizmo.addEventListener('objectChange', () => this.emitTransform())
    // three 0.171 TransformControls extends Controls (not Object3D); its visual
    // representation is the helper root returned by getHelper().
    this.engine.scene.add(this.gizmo.getHelper())
    domElement.addEventListener('pointerdown', this.onDown)
    domElement.addEventListener('pointerup', this.onUp)
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    this.downAt = [e.clientX, e.clientY]
    // NOTE: do not reset gizmoDragged here — the gizmo's earlier-registered
    // pointerdown listener has already latched it for handle grabs, and the
    // element's setPointerCapture guarantees onUp always fires to consume it.
  }

  private onUp = (e: PointerEvent) => {
    // Only treat as a click if the pointer didn't drag (orbit/gizmo own drags).
    if (e.button !== 0) return
    if (!this.downAt) return
    const [dx, dy] = [e.clientX - this.downAt[0], e.clientY - this.downAt[1]]
    this.downAt = null
    const wasGizmoDrag = this.gizmoDragged
    this.gizmoDragged = false
    if (Math.hypot(dx, dy) > 4 || wasGizmoDrag) return
    const rect = this.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.engine.camera)
    const roots = [...this.engine.objectRoots.values()].filter((r) => r.visible)
    const hits = this.raycaster.intersectObjects(roots, true)
    let id: string | null = null
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object
      while (node && !node.userData.sceneId) node = node.parent
      if (node?.userData.sceneId) { id = node.userData.sceneId; break }
    }
    this.select(id)
    this.callbacks.onSelect(id)
  }

  private emitTransform(): void {
    if (!this.selectedId) return
    const root = this.engine.objectRoots.get(this.selectedId)
    if (!root) return
    this.callbacks.onTransform(this.selectedId, {
      position: root.position.toArray() as Vec3,
      rotation: [root.rotation.x, root.rotation.y, root.rotation.z],
      scale: root.scale.toArray() as Vec3,
    })
  }

  setMode(mode: GizmoMode): void { this.gizmo.setMode(mode) }

  setSnap(enabled: boolean): void {
    this.gizmo.setTranslationSnap(enabled ? 0.25 : null)
    this.gizmo.setRotationSnap(enabled ? Math.PI / 12 : null)
    this.gizmo.setScaleSnap(enabled ? 0.1 : null)
  }

  select(id: string | null): void {
    this.selectedId = id
    const root = id ? this.engine.objectRoots.get(id) : undefined
    if (root) this.gizmo.attach(root)
    else this.gizmo.detach()
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onDown)
    this.domElement.removeEventListener('pointerup', this.onUp)
    this.gizmo.detach()
    // dispose() frees child geometry/materials but does not unparent _root.
    this.engine.scene.remove(this.gizmo.getHelper())
    this.gizmo.dispose()
    this.orbit.dispose()
  }
}
