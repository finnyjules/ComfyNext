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
//
// MULTI-SELECTION: TransformControls attaches to exactly one Object3D, so a
// selection of 2+ objects drives a transient PIVOT instead (see `selectMany`).
// The pivot exists for as long as the multi-selection does, but it only OWNS
// the selected roots for the duration of a drag — see `holdRoots` for why that
// window is deliberately as narrow as it is.
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
// Scratch instances for the per-pointermove decompose in `emitTransform`.
// Module-scope and reused: emitTransform runs once per selected object per
// pointermove, and a drag is the one place in this file where per-frame
// allocation would actually be paid for.
const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()

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
  // The ORDERED selection, mirroring the surface's `selectedIds`. Last entry is
  // the primary — the one a single-selection gizmo attaches to and the one
  // `emitTransform` reports when there is no pivot. Single source of truth in
  // here: nothing in this class keeps a separate scalar "selected id".
  private selectedIds: string[] = []
  /** Transient parent used to drive a MULTI-selection with a single gizmo.
   *  TransformControls attaches to exactly one Object3D, so the gizmos attach
   *  to this instead and the selected roots ride along under it. Object3D.attach
   *  preserves the world transform on the way IN and on the way OUT, which is
   *  why the pivot needs no delta maths of its own. Never added to doc.objects,
   *  and tagged isGizmoHelper so the bake/export passes skip it. */
  private pivot: THREE.Object3D | null = null
  /** True only between drag start and drag end — the window in which the roots
   *  are actually parented to the pivot, and therefore the window in which
   *  their local transforms are pivot-relative garbage as far as the doc is
   *  concerned. Read by the surface through `pivotDragActive`. */
  private pivotHolding = false
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
      onSelect: (id: string | null, additive: boolean) => void
      onTransform: (id: string, t: TransformSnapshot) => void
      /** Fired INSTEAD of onTransform while a multi-selection drag is live.
       *  Each entry carries the object's new WORLD transform — under the pivot
       *  a root's local TRS is meaningless to the doc, so the surface rebases
       *  each entry into its own parent's frame before writing. */
      onTransformMany?: (entries: { id: string; t: TransformSnapshot }[]) => void
      /** Fired once when a multi-selection drag ends, after the roots have been
       *  handed back to the scene. The surface suppresses engine.syncFromDoc
       *  for the duration of such a drag (see `pivotDragActive`), so this is its
       *  cue to run the sync that re-parents the roots to their doc parents. */
      onPivotDragEnd?: () => void
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
          // The multi-selection roots join the pivot HERE, at the grab, and
          // never mid-drag: three captured the pivot's own start transform in
          // its pointerdown handler (which runs BEFORE this listener) and
          // attaching CHILDREN never touches the parent's transform, so this is
          // invisible. Attaching one move later instead would hand the objects a
          // gizmo that has already consumed deltas they never saw — the
          // first-frame pop.
          this.holdRoots()
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
          // Give the roots back to the scene the instant the drag ends. The doc
          // already holds their rebased locals (the last objectChange wrote
          // them), so `reseatPivot` below can measure the fresh centre and the
          // surface's sync can re-parent them for real.
          const wasPivotDrag = this.pivotHolding
          this.releaseRoots()
          this.reseatPivot()
          for (const other of this.gizmos) other.enabled = true
          if (wasPivotDrag) this.callbacks.onPivotDragEnd?.()
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
    // Shift/Cmd/Ctrl extends the selection. We do NOT re-attach the gizmo here:
    // the surface owns the selection list and calls back into `selectMany`, so
    // attaching from both ends would be two sources of truth that disagree the
    // moment the surface's toggle rule (promote-on-reselect) differs from a
    // plain replace.
    const additive = e.shiftKey || e.metaKey || e.ctrlKey
    this.callbacks.onSelect(id, additive)
  }

  private emitTransform(): void {
    if (this.pivotHolding && this.pivot) {
      // The pivot's matrixWorld is STALE at this instant: three writes the new
      // position/quaternion/scale and dispatches objectChange without updating
      // any world matrix (the renderer does that later, at draw time). Refresh
      // the pivot's ancestors AND its subtree first — reading root.matrixWorld
      // without this returns the PREVIOUS pointermove's world transform, so the
      // doc trails the viewport by exactly one delta and every object snaps
      // backwards when the drag ends.
      this.pivot.updateWorldMatrix(true, true)
      const entries: { id: string; t: TransformSnapshot }[] = []
      for (const id of this.selectedIds) {
        const root = this.engine.objectRoots.get(id)
        if (!root) continue
        // Decompose the WORLD matrix rather than reading .position/.rotation:
        // while the pivot holds the root those are pivot-relative and mean
        // nothing to the doc, which stores locals under the object's REAL
        // parent. The surface does the rebase.
        root.matrixWorld.decompose(_p, _q, _s)
        _e.setFromQuaternion(_q, 'XYZ') // matches SceneObjectBase.rotation's documented order
        entries.push({
          id,
          t: { position: [_p.x, _p.y, _p.z], rotation: [_e.x, _e.y, _e.z], scale: [_s.x, _s.y, _s.z] },
        })
      }
      this.callbacks.onTransformMany?.(entries)
      return
    }
    const id = this.selectedIds[this.selectedIds.length - 1]
    if (!id) return
    const root = this.engine.objectRoots.get(id)
    if (!root) return
    this.callbacks.onTransform(id, {
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

  /** True while a multi-selection drag has the selected roots re-parented under
   *  the pivot. The surface MUST skip `engine.syncFromDoc` for as long as this
   *  holds: syncObject re-parents every root to its DOC parent on every sync,
   *  so a sync triggered by the drag's own doc writes would tear the roots out
   *  of the pivot after the first pointermove and leave the rest of the drag
   *  moving an empty pivot. `onPivotDragEnd` fires the sync that was skipped. */
  get pivotDragActive(): boolean { return this.pivotHolding }

  /** Attach the gizmo to `ids`. One id behaves exactly as before. Two or more
   *  build a pivot at the bounds centre of their roots and attach that instead.
   *  `isLight` only applies to a single selection — a mixed multi-selection has
   *  no one kind to hide the scale gizmo for. */
  selectMany(ids: string[], isLight = false): void {
    this.teardownPivot()
    this.selectedIds = [...ids]
    if (ids.length <= 1) { this.select(ids[0] ?? null, isLight); return }
    // Fewer than two live roots (an id whose object was removed between the doc
    // edit and this call) can't drive a pivot — fall back to a single selection
    // rather than a pivot that would move one object with the ceremony of many.
    // select() narrows selectedIds to match, so emitTransform reports exactly
    // what the gizmo actually drives.
    const roots = ids.map((id) => this.engine.objectRoots.get(id)).filter((r): r is THREE.Object3D => !!r)
    if (roots.length < 2) { this.select(ids[0] ?? null, isLight); return }
    const pivot = new THREE.Object3D()
    pivot.userData.isGizmoHelper = true // keep it out of every baked/exported pass
    this.engine.scene.add(pivot)
    this.pivot = pivot
    this.reseatPivot()
    for (const tc of this.gizmos) tc.attach(pivot)
  }

  /** Park the pivot at the bounds centre of the selected roots' world origins,
   *  with identity rotation and scale.
   *
   *  Called on selection and again after every drag — never at drag START.
   *  three captures the object's start transform in its own pointerdown, which
   *  runs before our dragging-changed listener, so moving the pivot at the grab
   *  would drag from a position the maths never saw (the gizmo jumps under the
   *  pointer). Re-seating to IDENTITY also matters: a pivot left non-uniformly
   *  scaled by the previous drag would shear a rotated child on the next
   *  attach, and Object3D.attach decomposes — dropping that shear silently
   *  deforms the object at the moment of the grab. */
  private reseatPivot(): void {
    const pivot = this.pivot
    if (!pivot) return
    const box = new THREE.Box3()
    for (const id of this.selectedIds) {
      const root = this.engine.objectRoots.get(id)
      if (root) box.expandByPoint(root.getWorldPosition(_p))
    }
    if (box.isEmpty()) return
    pivot.position.copy(box.getCenter(_p))
    pivot.rotation.set(0, 0, 0)
    pivot.scale.set(1, 1, 1)
    pivot.updateMatrixWorld(true)
  }

  /** Take ownership of the selected roots for the duration of one drag —
   *  `attach`, not `add`, so each root keeps its world transform and nothing
   *  moves at the grab. The window is deliberately this narrow: the engine
   *  re-parents every root to its doc parent on each syncFromDoc, so a pivot
   *  still holding roots when a sync ran would lose them mid-gesture (and,
   *  worse, a bake would hide the whole selection along with the tagged pivot). */
  private holdRoots(): void {
    const pivot = this.pivot
    if (!pivot || this.pivotHolding) return
    pivot.updateMatrixWorld(true)
    for (const id of this.selectedIds) {
      const root = this.engine.objectRoots.get(id)
      if (root) pivot.attach(root)
    }
    this.pivotHolding = true
  }

  /** Hand the roots back to the scene. `scene.attach` again, so the release is
   *  invisible; the surface's next sync puts each one under its real parent. */
  private releaseRoots(): void {
    this.pivotHolding = false
    const pivot = this.pivot
    if (!pivot) return
    for (const child of [...pivot.children]) this.engine.scene.attach(child)
  }

  /** Release the roots and drop the pivot. Called before every re-attach and on
   *  dispose — a leaked pivot would keep owning roots the engine believes it
   *  parents itself, and would linger in the scene as an untracked child. */
  private teardownPivot(): void {
    const pivot = this.pivot
    if (!pivot) return
    this.releaseRoots()
    pivot.removeFromParent()
    this.pivot = null
    for (const tc of this.gizmos) if (tc.object === pivot) tc.detach()
  }

  select(id: string | null, isLight = false): void {
    // Idempotent in the selectMany path (which tears down first), and the safety
    // net for any caller that drops straight from a multi-selection to a single
    // one — a pivot left behind would still own roots the engine parents itself.
    this.teardownPivot()
    this.selectedIds = id ? [id] : []
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
    // Before anything else: the pivot may still be holding roots (disposing
    // mid-drag is reachable — closing the studio with the pointer down), and
    // the engine disposes those roots by walking the scene.
    this.teardownPivot()
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
