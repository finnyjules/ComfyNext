// frontend/app/lib/scene3d/interaction.ts
// Viewport interaction: orbit camera, click-to-select raycasting, and a
// Spline-style COMBINED gizmo — move, rotate, and scale live on one gizmo with
// no mode switching. Three's TransformControls is single-mode, so we mount
// three pruned instances on the same object:
//   - translate: axis arrows only (planes + centre handle hidden)
//   - rotate:    the three axis arcs only (outer ring + view sphere hidden)
//   - scale:     the centre cube only (uniform scale; axis boxes hidden)
// Each instance raycasts only its own visible picker handles (TransformControls
// skips invisible pickers), so they never fight over a drag.
// Emits document-shaped mutations (TransformSnapshot) so the surface owns all
// SceneDoc writes — a future undo/redo hooks in there.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { Vec3 } from './config'
import type { SceneEngine } from './engine'

export interface TransformSnapshot { position: Vec3; rotation: Vec3; scale: Vec3 }

type GizmoMode = 'translate' | 'rotate' | 'scale'

/** Orbit is enabled only when neither lock is held. Pure so it's unit-testable
 *  without the DOM/WebGL context SceneInteraction requires. */
export function orbitShouldBeEnabled(cameraLocked: boolean, gizmoDragging: boolean): boolean {
  return !cameraLocked && !gizmoDragging
}

/** REMOVE every handle (visual AND picker) whose name isn't in `keep`.
 *  Setting `visible = false` is not enough: TransformControlsGizmo re-derives
 *  handle visibility every frame in its update loop, resurrecting hidden
 *  handles. Removing the children takes them out of both rendering and the
 *  picker raycast for good (geometry/materials disposed on the way out). */
function pruneGizmo(tc: TransformControls, mode: GizmoMode, keep: Set<string>): void {
  const inner = (tc as unknown as {
    _gizmo: { gizmo: Record<string, THREE.Object3D>; picker: Record<string, THREE.Object3D> }
  })._gizmo
  for (const kind of ['gizmo', 'picker'] as const) {
    const group = inner[kind][mode]
    if (!group) continue
    for (const child of [...group.children]) {
      if (keep.has(child.name)) continue
      group.remove(child)
      child.traverse((c) => {
        const mesh = c as THREE.Mesh
        if (mesh.isMesh || (c as THREE.Line).type === 'Line') {
          mesh.geometry?.dispose()
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((mm) => mm?.dispose())
        }
      })
    }
  }
}

export class SceneInteraction {
  readonly orbit: OrbitControls
  private gizmos: TransformControls[] = []
  private raycaster = new THREE.Raycaster()
  private selectedId: string | null = null
  private downAt: [number, number] | null = null
  // Latched from 'dragging-changed': a gizmo's own pointerup listener runs
  // before ours (registered earlier on the same element) and resets its
  // dragging flag, so onUp must consult this latch instead. Set on drag
  // start, consumed (read + cleared) inside onUp — a deferred clear wouldn't
  // survive the microtask checkpoint browsers run between listeners on
  // trusted events.
  private gizmoDragged = false
  // Shift while dragging a scale dot = uniform scale: the dragged axis's ratio
  // (vs the scale recorded at drag start) is applied to all three axes.
  private shiftDown = false
  private scaleDragStart: THREE.Vector3 | null = null
  // Single authority over `orbit.enabled`. Two independent concerns want to
  // disable orbit — camera motion playing back (surface calls setCameraLocked)
  // and a gizmo being dragged (the dragging-changed listener below) — so each
  // gets its own field and `orbit.enabled` is always the AND-negation of both,
  // recomputed through updateOrbitEnabled. Neither side may write
  // `orbit.enabled` directly: a per-frame writer that did so would silently
  // stomp the other's lock (this exact bug shipped once already — see
  // Scene3DStudioSurface's call sites for the full story).
  private cameraLocked = false
  private gizmoDragging = false

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

    // The combined gizmo: three pruned single-mode instances, spatially LAYERED
    // by size so their handles/pickers don't occupy the same span (all of
    // three's handles sit at ±0.5·size with pickers spanning 0→0.6·size — at
    // equal sizes the first instance swallows every axis grab):
    //   scale cubes innermost (0.55) · rotate arcs middle (0.9) · translate
    //   arrows outermost (1.3) — the Spline layering (dots → arcs → arrows).
    // ORDER = pointerdown priority for the remaining overlapping inner-shaft region
    // (mutual exclusion below disables later instances once one starts a drag).
    // No centre XYZ scale handle — three's centre-scale divides by the
    // pointer's start distance from the origin, which explodes near the centre.
    const parts: { mode: GizmoMode; keep: Set<string>; size: number }[] = [
      { mode: 'scale', keep: new Set(['X', 'Y', 'Z']), size: 0.55 },
      { mode: 'translate', keep: new Set(['X', 'Y', 'Z']), size: 1.3 },
      { mode: 'rotate', keep: new Set(['X', 'Y', 'Z']), size: 0.9 },
    ]
    for (const { mode, keep, size } of parts) {
      const tc = new TransformControls(engine.camera, domElement)
      tc.setMode(mode)
      tc.size = size
      pruneGizmo(tc, mode, keep)
      // TransformControls extends Controls (not Object3D — see note below), so
      // it has no userData; tag it via a cast so `select` can identify which
      // pruned instance is the scale one without a parallel lookup structure.
      ;(tc as unknown as { userData: Record<string, unknown> }).userData = { mode }
      tc.addEventListener('dragging-changed', (e) => {
        this.gizmoDragging = e.value
        this.updateOrbitEnabled()
        if (e.value) {
          this.gizmoDragged = true
          // Uniform-scale support: remember where the scale started.
          if (mode === 'scale') this.scaleDragStart = tc.object?.scale.clone() ?? null
          // Mutual exclusion: several instances can raycast-hit overlapping
          // pickers in the same pointerdown (each would then process the whole
          // drag → simultaneous translate+scale). The first to start dragging
          // (listener registration order = `parts` order) disables the rest;
          // their enabled-guard makes their later pointerdown listeners bail.
          for (const other of this.gizmos) if (other !== tc && !other.dragging) other.enabled = false
        } else {
          if (mode === 'scale') this.scaleDragStart = null
          for (const other of this.gizmos) other.enabled = true
        }
      })
      tc.addEventListener('objectChange', () => {
        // Shift + scale-dot drag → uniform: three has just set ONE axis to
        // start·ratio (it recomputes from the drag start every pointermove, so
        // overwriting here never corrupts the next move). Spread that ratio.
        if (mode === 'scale' && this.shiftDown && this.scaleDragStart && tc.object) {
          const s = tc.object.scale
          const start = this.scaleDragStart
          let ratio = 1
          let best = 0
          for (const axis of ['x', 'y', 'z'] as const) {
            const r = start[axis] !== 0 ? s[axis] / start[axis] : 1
            if (Math.abs(r - 1) > best) { best = Math.abs(r - 1); ratio = r }
          }
          s.set(start.x * ratio, start.y * ratio, start.z * ratio)
        }
        this.emitTransform()
      })
      // three 0.171 TransformControls extends Controls (not Object3D); its
      // visual representation is the helper root returned by getHelper().
      // Tag it so the bake (renderPasses) can hide it — the gizmo shares
      // engine.scene, so an attached gizmo would otherwise bleed into every
      // baked pass (visible handles in beauty, false geometry in depth/normal).
      const helper = tc.getHelper()
      helper.userData.isGizmoHelper = true
      this.engine.scene.add(helper)
      this.gizmos.push(tc)
    }

    domElement.addEventListener('pointerdown', this.onDown)
    domElement.addEventListener('pointermove', this.onMove)
    domElement.addEventListener('pointerup', this.onUp)
  }

  /** Recomputes `orbit.enabled` from the two locks. Called whenever either
   *  changes — never write `orbit.enabled` directly (see field comments). */
  private updateOrbitEnabled(): void {
    this.orbit.enabled = orbitShouldBeEnabled(this.cameraLocked, this.gizmoDragging)
  }

  /** Surface-owned lock: true while camera motion is animating playback.
   *  Safe (and expected) to call every frame — it's a cheap idempotent
   *  recompute, not a raw write, so it can never stomp a concurrent gizmo
   *  drag's lock the way a direct `orbit.enabled = ...` write would. */
  setCameraLocked(locked: boolean): void {
    this.cameraLocked = locked
    this.updateOrbitEnabled()
  }

  // Shift state rides on the pointer events (works for real keyboards AND
  // synthetic modifier-annotated drags; keydown tracking would miss the
  // latter). During an active gizmo drag, a modifier-less move can never turn
  // Shift OFF — synthetic drags annotate only pointerdown/up, and the drag's
  // starting state should govern. Pressing Shift mid-drag still engages live.
  private onMove = (e: PointerEvent) => {
    const dragging = this.gizmos.some((g) => g.dragging)
    if (!dragging || e.shiftKey) this.shiftDown = e.shiftKey
  }

  private onDown = (e: PointerEvent) => {
    this.shiftDown = e.shiftKey
    if (e.button !== 0) return
    this.downAt = [e.clientX, e.clientY]
    // NOTE: do not reset gizmoDragged here — the gizmos' earlier-registered
    // pointerdown listeners have already latched it for handle grabs, and the
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

  setSnap(enabled: boolean): void {
    for (const tc of this.gizmos) {
      tc.setTranslationSnap(enabled ? 0.25 : null)
      tc.setRotationSnap(enabled ? Math.PI / 12 : null)
      tc.setScaleSnap(enabled ? 0.1 : null)
    }
  }

  select(id: string | null, isLight = false): void {
    this.selectedId = id
    const root = id ? this.engine.objectRoots.get(id) : undefined
    for (const tc of this.gizmos) {
      const mode = (tc as unknown as { userData: Record<string, unknown> }).userData.mode
      if (root) {
        if (isLight && mode === 'scale') tc.detach()
        else tc.attach(root)
      } else {
        tc.detach()
      }
    }
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onDown)
    this.domElement.removeEventListener('pointermove', this.onMove)
    this.domElement.removeEventListener('pointerup', this.onUp)
    for (const tc of this.gizmos) {
      tc.detach()
      // dispose() frees child geometry/materials but does not unparent _root.
      this.engine.scene.remove(tc.getHelper())
      tc.dispose()
    }
    this.gizmos = []
    this.orbit.dispose()
  }
}
