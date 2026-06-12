<script setup lang="ts">
/**
 * WidgetLightGimbal — light-direction gizmo for the Relight node. Forked from
 * WidgetCameraGimbal: same pseudo-3D SVG sphere + inline 3×3 rotation math, but
 * it controls a KEY LIGHT instead of a camera. The user drags ring handles (or
 * the sun glyph) to aim the light by azimuth + elevation, and a slider sets its
 * intensity. A director-style phrase is generated live, mirroring the Python
 * `light_to_phrase` in comfy_extras/_relight_prompts.py so the user sees exactly
 * what's about to be sent.
 *
 * Internally the widget keeps the proven yaw/pitch/roll state (azimuth↔yaw,
 * elevation↔pitch, roll forced to 0 and its ring/handle hidden) so all the
 * ring/handle/projection math is reused untouched. Only the parse/serialize
 * boundary, the caption, the glyph and the intensity slider differ.
 *
 * State is a JSON string in widgetsValues: `{"azimuth":N,"elevation":N,"intensity":N}`.
 * azimuth/elevation are degrees (azimuth normalized to (-180, 180], elevation
 * clamped to [-90, 90]); intensity is 0..1. Malformed values fall back to
 * (0, 0, 0.6).
 */
import { RotateCcw } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: string                     // JSON: {"azimuth":N,"elevation":N,"intensity":N}
  label?: string
  nodeId?: string                        // for upstream image lookup
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// ---- Upstream image lookup -------------------------------------------------
//
// Reach into the live canvas state to find whatever's plugged into our node's
// `image` input. We render it inside the gimbal as a 3D-transformed plane so
// the user sees the subject they're rotating, not an abstract sphere.

const injectedNodes = inject<any>('vueFlowNodes', null)
const injectedEdges = inject<any>('vueFlowEdges', null)

const upstreamImageUrl = computed<string | null>(() => {
  if (!props.nodeId || !injectedEdges?.value || !injectedNodes?.value) return null
  // Find the edge feeding our "image" input. Vue Flow's handle ids are
  // "input-{index}" — for RotateCameraNode, `image` is the first (index 0).
  const edge = injectedEdges.value.find((e: any) =>
    e.target === props.nodeId && (e.targetHandle === 'input-0' || e.targetHandle === 'input-image'))
  if (!edge) return null
  const src = injectedNodes.value.find((n: any) => n.id === edge.source)
  if (!src) return null
  // Prefer the node's rendered output (images array, populated after a run).
  if (src.data?.images?.length) return String(src.data.images[0])
  // Fall back to a LoadImage widget value — lets the user preview before run.
  const t = src.data?.nodeType
  if (t === 'LoadImage') {
    const idx = (src.data.widgetDefs ?? []).findIndex((d: any) => d.name === 'image')
    const filename = src.data.widgetsValues?.[idx >= 0 ? idx : 0]
    if (filename) return `/view?${new URLSearchParams({ filename: String(filename), type: 'input' })}`
  }
  return null
})

// ---- Local state (degrees) -------------------------------------------------

function parseValue(s: string): { yaw: number; pitch: number; roll: number } {
  try {
    const o = JSON.parse(s || '{}')
    return {
      yaw:   Number.isFinite(+o.azimuth)   ? +o.azimuth   : 0,   // azimuth → internal yaw
      pitch: Number.isFinite(+o.elevation) ? +o.elevation : 0,   // elevation → internal pitch
      roll:  0,                                                  // light has no roll
    }
  } catch { return { yaw: 0, pitch: 0, roll: 0 } }
}
function parseIntensity(s: string): number {
  try {
    const o = JSON.parse(s || '{}')
    return Number.isFinite(+o.intensity) ? Math.max(0, Math.min(1, +o.intensity)) : 0.6
  } catch { return 0.6 }
}

const angles = ref(parseValue(props.modelValue))
const intensity = ref(parseIntensity(props.modelValue))
watch(() => props.modelValue, v => { angles.value = parseValue(v); intensity.value = parseIntensity(v) })

function normalize(deg: number): number {
  // Wrap into (-180, 180]
  const d = ((deg % 360) + 540) % 360 - 180
  return d === -180 ? 180 : d
}

function commit() {
  const out = {
    azimuth:   +normalize(angles.value.yaw).toFixed(2),
    elevation: +Math.max(-90, Math.min(90, angles.value.pitch)).toFixed(2),
    intensity: +intensity.value.toFixed(2),
  }
  emit('update:modelValue', JSON.stringify(out))
}

// ---- 3×3 matrix math (inline, no deps) -------------------------------------

type Mat3 = [number, number, number, number, number, number, number, number, number]
type Vec3 = [number, number, number]

const deg = (d: number) => d * Math.PI / 180

function mul(a: Mat3, b: Mat3): Mat3 {
  // Row-major 3x3 multiply.
  const r: number[] = new Array(9)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
  }
  return r as Mat3
}

function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

function Rx(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c] }
function Ry(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c] }
function Rz(a: number): Mat3 { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1] }

// Fixed viewing transform — a slight tilt down + to the side so all three axes
// read in 3/4 view. This is the camera-look-at orientation of the WIDGET itself,
// independent of the user's yaw/pitch/roll.
const VIEW_TILT_DEG = -22  // look down a bit
const VIEW_PAN_DEG  = -28  // rotate around vertical
const viewMatrix: Mat3 = mul(Rx(deg(VIEW_TILT_DEG)), Ry(deg(VIEW_PAN_DEG)))

// ---- Gimbal structure ------------------------------------------------------
//
// Camera-orbits-subject metaphor: the IMAGE sits fixed at world origin,
// and the gimbal shows where the LIGHT SOURCE is on a sphere around it.
//
// Three nested frames, like a real 3-axis gimbal:
//   - Yaw ring (green):   fixed; the equator the camera orbits horizontally
//   - Pitch ring (red):   rotates around the world-Y axis with yaw, so it
//                         always passes through the camera meridian
//   - Roll ring (blue):   rotates with yaw+pitch; sits perpendicular to the
//                         camera's look direction (visualizes Dutch tilt)
//
// userMatrix is GONE — the image used to consume it, but the image is now
// fixed. Per-ring matrices below replace it.

// Pitch-ring frame: yaw-only rotation, layered on the view tilt.
const pitchRingMatrix = computed<Mat3>(() =>
  mul(viewMatrix, Ry(deg(angles.value.yaw))))

// Roll-ring frame: yaw + pitch, layered on the view tilt.
const rollRingMatrix = computed<Mat3>(() =>
  mul(viewMatrix, mul(Ry(deg(angles.value.yaw)), Rx(deg(angles.value.pitch)))))

// Camera sits at a distance > 1 so it floats OUTSIDE the gimbal rings (whose
// handles live on the unit sphere). Without this, at the default front view
// the camera, yaw handle, and pitch handle all stack at (0,0,1). Pushing the
// camera out to 1.35 separates it cleanly and reads as "the camera is over
// here, at a distance, looking in."
const CAMERA_DIST = 1.28

// Camera position. Standard spherical, scaled by CAMERA_DIST:
//   yaw=0,  pitch=0   → +Z  (directly in front)
//   yaw=90, pitch=0   → +X  (to the right)
//   yaw=0,  pitch=90  → +Y  (above)
const cameraWorldPos = computed<Vec3>(() => {
  const y = deg(angles.value.yaw)
  const p = deg(angles.value.pitch)
  return [
    Math.sin(y) * Math.cos(p) * CAMERA_DIST,
    Math.sin(p) * CAMERA_DIST,
    Math.cos(y) * Math.cos(p) * CAMERA_DIST,
  ]
})

// ---- Projection ------------------------------------------------------------

const SVG_SIZE = 240
const RADIUS = 92                    // ring radius in SVG units
const CENTER = SVG_SIZE / 2

function project(p3: Vec3): { x: number; y: number; z: number } {
  // Orthographic: x stays x, y inverts (SVG y grows downward), z preserved
  // for depth sorting / opacity.
  return { x: CENTER + p3[0] * RADIUS, y: CENTER - p3[1] * RADIUS, z: p3[2] }
}

// ---- Ring path generation --------------------------------------------------
//
// Each ring is sampled at N points and built as a series of line segments
// with per-segment opacity based on midpoint z. Splitting by segment gives a
// continuous front-to-back fade instead of a hard "front half / back half"
// edge that would look wrong at arbitrary rotations.

const RING_SAMPLES = 64

interface RingSegment { d: string; opacity: number; midZ: number }

/**
 * axis: 'x' (pitch ring), 'y' (yaw ring), 'z' (roll ring).
 * Each ring lives in its OWN reference frame per the gimbal structure:
 *  - yaw ring stays in the world equator (only viewMatrix)
 *  - pitch ring rotates with yaw
 *  - roll ring rotates with yaw + pitch
 */
function ringSegments(axis: 'x' | 'y' | 'z'): RingSegment[] {
  const out: RingSegment[] = []
  const m = axis === 'y' ? viewMatrix
          : axis === 'x' ? pitchRingMatrix.value
          :                 rollRingMatrix.value
  for (let i = 0; i < RING_SAMPLES; i++) {
    const t0 = (i       / RING_SAMPLES) * Math.PI * 2
    const t1 = ((i + 1) / RING_SAMPLES) * Math.PI * 2
    // Local circle in canonical plane:
    //   pitch ring (X): YZ plane → (0, cos t, sin t)
    //   yaw ring   (Y): XZ plane → (sin t, 0, cos t)  — sin/cos swapped so
    //                              t=0 is +Z (front), matching camera-pos formula
    //   roll ring  (Z): XY plane → (cos t, sin t, 0)
    const a: Vec3 = axis === 'x' ? [0, Math.cos(t0), Math.sin(t0)]
                  : axis === 'y' ? [Math.sin(t0), 0, Math.cos(t0)]
                  :                 [Math.cos(t0), Math.sin(t0), 0]
    const b: Vec3 = axis === 'x' ? [0, Math.cos(t1), Math.sin(t1)]
                  : axis === 'y' ? [Math.sin(t1), 0, Math.cos(t1)]
                  :                 [Math.cos(t1), Math.sin(t1), 0]
    const pa = project(apply(m, a))
    const pb = project(apply(m, b))
    const midZ = (pa.z + pb.z) / 2
    const op = 0.18 + 0.82 * Math.max(0, Math.min(1, (midZ + 1) / 2))
    out.push({ d: `M${pa.x.toFixed(2)},${pa.y.toFixed(2)} L${pb.x.toFixed(2)},${pb.y.toFixed(2)}`, opacity: op, midZ })
  }
  return out
}

const xRing = computed(() => ringSegments('x'))
const yRing = computed(() => ringSegments('y'))
// Roll ring (z) intentionally omitted — a light has no roll.

// ---- Handle positions ------------------------------------------------------
//
// Each handle slides ALONG its ring as its corresponding axis changes — so
// the handle's position tells you the axis's current value at a glance.
//   Yaw handle:   on the equator at angle=yaw   (= the camera's azimuth point)
//   Pitch handle: on the pitch ring at angle=pitch (lifts off the equator)
//   Roll handle:  on the roll ring at angle=roll
//
// The yaw handle and the camera indicator are co-located when pitch=0 (both
// at the camera's footprint on the equator). When pitch ≠ 0 they separate:
// the yaw handle stays at the equator, the camera lifts to its real altitude.

interface Handle { x: number; y: number; z: number; axis: 'x' | 'y' | 'z' }

function handle(axis: 'x' | 'y' | 'z'): Handle {
  let local: Vec3
  let m: Mat3
  if (axis === 'y') {
    // Yaw handle on the fixed equator, at angle=yaw.
    const t = deg(angles.value.yaw)
    local = [Math.sin(t), 0, Math.cos(t)]
    m = viewMatrix
  } else if (axis === 'x') {
    // Pitch handle on the yaw-rotated pitch ring, at angle=pitch.
    const t = deg(angles.value.pitch)
    local = [0, Math.sin(t), Math.cos(t)]
    m = pitchRingMatrix.value
  } else {
    // Roll handle on the yaw+pitch-rotated roll ring, at angle=roll.
    const t = deg(angles.value.roll)
    local = [Math.cos(t), Math.sin(t), 0]
    m = rollRingMatrix.value
  }
  const p = project(apply(m, local))
  return { x: p.x, y: p.y, z: p.z, axis }
}

// Light gimbal: only azimuth (yaw) + elevation (pitch) handles. The roll ('z')
// handle is dropped — a light has no roll. Roll stays 0 throughout.
const handles = computed<Handle[]>(() => [handle('x'), handle('y')])

// ---- Camera indicator ------------------------------------------------------
//
// A small camera glyph at the orbit position, with a tether line back to the
// subject. The user can drag this directly to free-orbit yaw + pitch.

interface CameraIndicator {
  x: number; y: number; z: number     // screen position + depth
  fromX: number; fromY: number        // origin of the tether line (screen center)
  angle: number                       // degrees: rotation so the lens faces the subject
  flip: number                        // 1 or -1: keep the body upright when facing left
  dist: number                        // screen distance camera→subject
}
const cameraIndicator = computed<CameraIndicator>(() => {
  const p = project(apply(viewMatrix, cameraWorldPos.value))
  // Aim the glyph's lens (local +X) at the subject (screen center).
  const dx = CENTER - p.x
  const dy = CENTER - p.y
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  // Flip vertically when the camera sits on the left half so it never appears
  // upside-down (same trick map labels use to stay readable).
  const flip = Math.abs(angle) > 90 ? -1 : 1
  return { x: p.x, y: p.y, z: p.z, fromX: CENTER, fromY: CENTER, angle, flip, dist: Math.hypot(dx, dy) }
})

// ---- Axis arrow tips -------------------------------------------------------
//
// Reference arrows from origin along each gimbal axis — placed in their
// per-ring frame so the user can see which direction is "yaw forward" etc.

interface Arrow { tipX: number; tipY: number; tipZ: number; axis: 'x' | 'y' | 'z'; color: string }

const arrows = computed<Arrow[]>(() => {
  const out: Arrow[] = []
  // The X arrow points along the pitch axis (lives in the pitch ring's frame)
  const xTip = project(apply(pitchRingMatrix.value, [1.15, 0, 0]))
  out.push({ tipX: xTip.x, tipY: xTip.y, tipZ: xTip.z, axis: 'x', color: AXIS_COLORS.x })
  // Y arrow = world up, fixed
  const yTip = project(apply(viewMatrix, [0, 1.15, 0]))
  out.push({ tipX: yTip.x, tipY: yTip.y, tipZ: yTip.z, axis: 'y', color: AXIS_COLORS.y })
  // Z (roll / look-axis) arrow intentionally omitted — a light has no roll.
  return out
})

const AXIS_COLORS = {
  x: '#f97373',   // red  — pitch
  y: '#7bd86b',   // green — yaw
  z: '#5fa3ff',   // blue — roll
}

// ---- Interaction -----------------------------------------------------------
//
// Two drag modes:
//   1. Free orbit: pointerdown on the sphere body (not on a handle). Mouse X
//      delta → yaw, mouse Y delta → pitch. Roll untouched. This is the most
//      common interaction.
//   2. Handle drag: pointerdown on a handle. Mouse delta is projected onto
//      the handle's screen-space tangent, scaled to degrees. Touch only that
//      one axis. The other two are untouched.

const SVG_ROOT = ref<SVGSVGElement | null>(null)

type Drag =
  | { kind: 'orbit';  lastX: number; lastY: number }
  | { kind: 'camera' }  // dragging the camera indicator directly (free orbit)
  | { kind: 'handle'; axis: 'x' | 'y' | 'z' }
  | null

let drag: Drag = null

// Hover state — visually highlights the handle under the cursor so the
// affordance is clearer. Drag overrides hover (highlight the dragged axis).
const hoveredAxis = ref<'x' | 'y' | 'z' | null>(null)

// We need this to be reactive even though `drag` is a plain `let`. Bump on
// every pointerdown/up; the computed reads it to subscribe.
const dragTick = ref(0)

// Reactive "axis currently being interacted with" — hover OR active drag.
const activeAxis = computed<'x' | 'y' | 'z' | null>(() => {
  void dragTick.value  // subscribe — recompute whenever drag state changes
  if (drag && drag.kind === 'handle') return drag.axis
  return hoveredAxis.value
})

// Per-axis opacity multiplier: when a handle is hovered or dragged, dim the
// other two axes so the active one reads as the focus.
function axisOpacity(axis: 'x' | 'y' | 'z'): number {
  if (!activeAxis.value) return 1
  return activeAxis.value === axis ? 1 : 0.35
}

function angleForAxis(axis: 'x' | 'y' | 'z'): number {
  if (axis === 'x') return angles.value.pitch
  if (axis === 'y') return angles.value.yaw
  return angles.value.roll
}
function setAngleForAxis(axis: 'x' | 'y' | 'z', deg: number) {
  if (axis === 'x') angles.value.pitch = Math.max(-90, Math.min(90, deg))
  else if (axis === 'y') angles.value.yaw = normalize(deg)
  else angles.value.roll = normalize(deg)
}

/**
 * Find the angle for the named axis such that ITS handle projects closest
 * to the target screen point. Brute-force sweep at 1° resolution.
 *
 * Each axis's handle lives in a different reference frame:
 *  - yaw handle:   on the equator, position (sin θ, 0, cos θ) under viewMatrix
 *  - pitch handle: on the pitch ring, position (0, sin θ, cos θ) under
 *                  viewMatrix * Ry(current yaw)
 *  - roll handle:  on the roll ring, position (cos θ, sin θ, 0) under
 *                  viewMatrix * Ry(current yaw) * Rx(current pitch)
 *
 * Holding the OTHER axes fixed at their current values is what makes the
 * handle stay on its visible ring as the user drags — they grab a handle,
 * the ring stays put, the handle slides around it.
 */
function findAngleForAxis(axis: 'x' | 'y' | 'z', sx: number, sy: number): number {
  let bestAngle = angleForAxis(axis)
  let bestDist = Infinity

  for (let i = 0; i < 360; i++) {
    const aDeg = i - 180
    const aRad = deg(aDeg)
    let local: Vec3
    let m: Mat3
    if (axis === 'y') {
      local = [Math.sin(aRad), 0, Math.cos(aRad)]
      m = viewMatrix
    } else if (axis === 'x') {
      local = [0, Math.sin(aRad), Math.cos(aRad)]
      m = pitchRingMatrix.value
    } else {
      local = [Math.cos(aRad), Math.sin(aRad), 0]
      m = rollRingMatrix.value
    }
    const screen = project(apply(m, local))
    const d = (screen.x - sx) * (screen.x - sx) + (screen.y - sy) * (screen.y - sy)
    if (d < bestDist) { bestDist = d; bestAngle = aDeg }
  }
  return bestAngle
}

function clientToSvg(e: PointerEvent): { x: number; y: number } {
  // Convert client coords to SVG-local coords. Uses the element's bounding
  // rect — accounts for any scaling / scrolling.
  const svg = SVG_ROOT.value
  if (!svg) return { x: 0, y: 0 }
  const rect = svg.getBoundingClientRect()
  return {
    x: ((e.clientX - rect.left) / rect.width) * SVG_SIZE,
    y: ((e.clientY - rect.top) / rect.height) * SVG_SIZE,
  }
}

function onSpherePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  drag = { kind: 'orbit', lastX: e.clientX, lastY: e.clientY }
  dragTick.value++
}

/**
 * Drag the camera indicator directly — free orbit that updates yaw + pitch
 * together to put the camera under the cursor. Brute-force the (yaw, pitch)
 * pair that projects the camera closest to the mouse position.
 *
 * This is the most intuitive interaction for the new metaphor: "grab the
 * camera, drop it where I want it pointing from."
 */
function onCameraPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  drag = { kind: 'camera' }
  dragTick.value++
  // Immediate jump on click.
  const m = clientToSvg(e)
  const { yaw, pitch } = findYawPitchForCamera(m.x, m.y)
  angles.value.yaw = e.shiftKey ? Math.round(yaw / 15) * 15 : yaw
  angles.value.pitch = e.shiftKey ? Math.round(pitch / 15) * 15 : pitch
  commit()
}

/**
 * Find (yaw, pitch) that puts the camera indicator closest to a target screen
 * point. 36x18 grid (10° resolution) ≈ 648 samples — cheap enough at 60fps.
 */
function findYawPitchForCamera(sx: number, sy: number): { yaw: number; pitch: number } {
  let bestYaw = angles.value.yaw
  let bestPitch = angles.value.pitch
  let bestDist = Infinity
  // Coarse pass at 10° resolution, then refine ±10° at 1° around the winner.
  // Splits 648 samples into 648 + 20×20 = ~1100, runs in well under a ms.
  const tryAngle = (y: number, p: number) => {
    // Same CAMERA_DIST scaling as the indicator so the glyph lands under the
    // cursor during a drag.
    const pos: Vec3 = [
      Math.sin(deg(y)) * Math.cos(deg(p)) * CAMERA_DIST,
      Math.sin(deg(p)) * CAMERA_DIST,
      Math.cos(deg(y)) * Math.cos(deg(p)) * CAMERA_DIST,
    ]
    const s = project(apply(viewMatrix, pos))
    const d = (s.x - sx) * (s.x - sx) + (s.y - sy) * (s.y - sy)
    if (d < bestDist) { bestDist = d; bestYaw = y; bestPitch = p }
  }
  for (let y = -180; y < 180; y += 10) {
    for (let p = -90; p <= 90; p += 10) tryAngle(y, p)
  }
  // Refine.
  const cy = bestYaw, cp = bestPitch
  for (let y = cy - 10; y <= cy + 10; y++) {
    for (let p = Math.max(-90, cp - 10); p <= Math.min(90, cp + 10); p++) tryAngle(y, p)
  }
  return { yaw: bestYaw, pitch: bestPitch }
}

function onHandlePointerDown(e: PointerEvent, axis: 'x' | 'y' | 'z') {
  if (e.button !== 0) return
  e.stopPropagation()
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  drag = { kind: 'handle', axis }
  dragTick.value++
  // Apply immediately so the first frame jumps to wherever the user clicked
  // (consistent with grab-and-drag UX in 3D tools).
  const m = clientToSvg(e)
  const a = findAngleForAxis(axis, m.x, m.y)
  setAngleForAxis(axis, e.shiftKey ? Math.round(a / 15) * 15 : a)
  commit()
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  if (drag.kind === 'orbit') {
    const dx = e.clientX - drag.lastX
    const dy = e.clientY - drag.lastY
    drag.lastX = e.clientX
    drag.lastY = e.clientY
    const sens = e.shiftKey ? 1.0 : 0.5
    angles.value.yaw   = normalize(angles.value.yaw + dx * sens)
    angles.value.pitch = Math.max(-90, Math.min(90, angles.value.pitch - dy * sens))
    if (e.shiftKey) snapToFifteen()
    commit()
  } else if (drag.kind === 'camera') {
    // Camera-indicator drag: brute-force search for the (yaw, pitch) that
    // puts the camera under the cursor. // Roll stays 0 — a light has no roll axis.
    const m = clientToSvg(e)
    const { yaw, pitch } = findYawPitchForCamera(m.x, m.y)
    angles.value.yaw   = e.shiftKey ? Math.round(yaw / 15) * 15 : yaw
    angles.value.pitch = e.shiftKey ? Math.round(pitch / 15) * 15 : pitch
    commit()
  } else if (drag.kind === 'handle') {
    const m = clientToSvg(e)
    const a = findAngleForAxis(drag.axis, m.x, m.y)
    setAngleForAxis(drag.axis, e.shiftKey ? Math.round(a / 15) * 15 : a)
    commit()
  }
}

function onPointerUp(e: PointerEvent) {
  if (!drag) return
  ;(e.currentTarget as Element).releasePointerCapture(e.pointerId)
  drag = null
  dragTick.value++
}

function snapToFifteen() {
  angles.value.yaw   = Math.round(angles.value.yaw   / 15) * 15
  angles.value.pitch = Math.round(angles.value.pitch / 15) * 15
}

function resetAll() {
  angles.value = { yaw: 0, pitch: 0, roll: 0 }
  intensity.value = 0.6
  commit()
}

// Quick-preset jumps to canonical light directions (azimuth/elevation). Roll is
// always 0 for a light.
const PRESETS: { label: string; yaw: number; pitch: number; roll: number }[] = [
  { label: 'Front',  yaw:   0, pitch:  0,  roll: 0 },
  { label: 'Side',   yaw:  90, pitch:  0,  roll: 0 },
  { label: 'Back',   yaw: 180, pitch:  0,  roll: 0 },
  { label: 'Top',    yaw:   0, pitch: 75,  roll: 0 },
  { label: '3/4',    yaw:  35, pitch: 15,  roll: 0 },
]
function applyPreset(p: { yaw: number; pitch: number; roll: number }) {
  angles.value = { yaw: p.yaw, pitch: p.pitch, roll: p.roll }
  commit()
}

// ---- Phrase translator — mirrors comfy_extras/_relight_prompts.py ----------
//
// Keep buckets and wording in sync with the Python `light_to_phrase`.
// The widget shows this live so the user sees exactly what's about to be sent.
// Internally azimuth = yaw, elevation = pitch.

function directionPhrase(azDeg: number): string {
  const a = ((azDeg + 180) % 360 + 360) % 360 - 180
  const aa = Math.abs(a)
  if (aa < 22.5)  return 'from the front'
  if (aa > 157.5) return 'from behind'
  if (a > 0) {
    if (aa < 67.5)  return 'from the front-right'
    if (aa < 112.5) return 'from the right'
    return 'from the back-right'
  } else {
    if (aa < 67.5)  return 'from the front-left'
    if (aa < 112.5) return 'from the left'
    return 'from the back-left'
  }
}
function elevationPhrase(elDeg: number): string | null {
  const e = Math.max(-90, Math.min(90, elDeg))
  if (Math.abs(e) < 15) return null
  if (e > 0) return e < 45 ? 'above' : e < 75 ? 'high above' : 'directly overhead'
  const ae = Math.abs(e)
  return ae < 45 ? 'slightly below' : ae < 75 ? 'below' : 'far below'
}
function intensityPhrase(i: number): string {
  const v = Math.max(0, Math.min(1, i))
  if (v < 0.25) return 'soft, diffused'
  if (v < 0.5)  return 'moderate'
  if (v < 0.75) return 'strong, defined'
  return 'dramatic, high-contrast'
}
const phrase = computed(() => {
  let s = `a ${intensityPhrase(intensity.value)} key light ${directionPhrase(angles.value.yaw)}`
  const h = elevationPhrase(angles.value.pitch)
  if (h) s += `, positioned ${h}`
  return s
})

// Numeric readout — small monospace caption so the user can see exact values.
const readout = computed(() => {
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}°`
  return `azimuth ${fmt(normalize(angles.value.yaw))}  ·  elevation ${fmt(angles.value.pitch)}  ·  intensity ${(intensity.value * 100).toFixed(0)}%`
})

// 6-point hex rotated to read horizontally. Used by handle markers.
function hexPoints(r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6
    pts.push(`${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`)
  }
  return pts.join(' ')
}

// The subject image stays fixed (the camera orbits it), but we orient it to lie
// in the world XY plane — i.e. facing +Z, the "front" the camera sits at —
// using the SAME view transform as the gimbal rings. So at the default front
// view the camera reads as floating in front of the image's face, not off to
// the side. The plane doesn't rotate with the user's angles; only the camera moves.
const FLIP_Y: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, 1]
const planeTransform = computed(() => {
  // CSS is Y-down / Z-toward-viewer while our math is Y-up; conjugating the view
  // rotation by a Y-flip (M = F·V·F) lines the plane up exactly with the rings.
  const M = mul(FLIP_Y, mul(viewMatrix, FLIP_Y))
  // matrix3d is column-major — embed the row-major 3×3 rotation into the 4×4.
  const m = [
    M[0], M[3], M[6], 0,
    M[1], M[4], M[7], 0,
    M[2], M[5], M[8], 0,
    0, 0, 0, 1,
  ]
  return { transform: `matrix3d(${m.join(',')})` }
})
</script>

<template>
  <div class="nopan nodrag camera-gimbal">
    <div v-if="label" class="camera-gimbal__label">{{ label }}</div>

    <!-- Stage -->
    <div class="camera-gimbal__stage">
      <!-- Subject reference: the connected image as a 3D plane. Rotates with
           the user's angles so the user literally sees the rotation they're
           dialing. Sits behind the SVG gimbal so the rings read as a
           control surface around the subject. -->
      <div class="camera-gimbal__subject">
        <div class="camera-gimbal__subject-plane" :style="planeTransform">
          <img
            v-if="upstreamImageUrl"
            :src="upstreamImageUrl"
            class="camera-gimbal__subject-img"
            draggable="false"
            referrerpolicy="no-referrer"
          />
          <div v-else class="camera-gimbal__subject-empty">
            Connect an image
          </div>
        </div>
      </div>

      <svg
        ref="SVG_ROOT"
        :width="SVG_SIZE"
        :height="SVG_SIZE"
        :viewBox="`0 0 ${SVG_SIZE} ${SVG_SIZE}`"
        class="camera-gimbal__svg"
      >
        <!-- Soft radial background — gives the gimbal a "lit sphere" feel. -->
        <defs>
          <radialGradient id="lg-gimbal-bg" cx="50%" cy="40%" r="55%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
            <stop offset="100%" stop-color="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <circle :cx="CENTER" :cy="CENTER" :r="RADIUS + 6" fill="url(#lg-gimbal-bg)" />

        <!-- Invisible drag-catcher disc covering the sphere body. Sits BEHIND
             the rings so handle clicks beat the body click. -->
        <circle
          :cx="CENTER" :cy="CENTER" :r="RADIUS + 4"
          fill="transparent"
          style="cursor: grab;"
          @pointerdown="onSpherePointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />

        <!-- Rings: drawn as per-segment line paths with depth-based opacity.
             X (pitch) red, Y (yaw) green, Z (roll) blue. Whole-axis opacity
             dims when another axis is hovered/dragged so the active one
             stands out. -->
        <g style="pointer-events: none;">
          <g :opacity="axisOpacity('y')">
            <path
              v-for="(seg, i) in yRing"
              :key="`y-${i}`"
              :d="seg.d"
              :stroke="AXIS_COLORS.y"
              :opacity="seg.opacity"
              :stroke-width="activeAxis === 'y' ? 3.5 : 2.5"
              fill="none"
            />
          </g>
          <g :opacity="axisOpacity('x')">
            <path
              v-for="(seg, i) in xRing"
              :key="`x-${i}`"
              :d="seg.d"
              :stroke="AXIS_COLORS.x"
              :opacity="seg.opacity"
              :stroke-width="activeAxis === 'x' ? 3.5 : 2.5"
              fill="none"
            />
          </g>
          <!-- Roll ring (blue Z) removed: a light has no roll. -->
        </g>

        <!-- Axis arrows from the origin. Back-facing arrows dim out. -->
        <g style="pointer-events: none;">
          <line
            v-for="arr in arrows"
            :key="`arr-line-${arr.axis}`"
            :x1="CENTER" :y1="CENTER"
            :x2="arr.tipX" :y2="arr.tipY"
            :stroke="arr.color"
            :opacity="arr.tipZ > 0 ? 0.9 : 0.35"
            stroke-width="2.2"
            stroke-linecap="round"
          />
          <!-- Arrowhead: small triangle. Rotated toward the tip direction. -->
          <polygon
            v-for="arr in arrows"
            :key="`arr-head-${arr.axis}`"
            :points="`-5,-3.5 -5,3.5 3,0`"
            :transform="`translate(${arr.tipX}, ${arr.tipY}) rotate(${Math.atan2(arr.tipY - CENTER, arr.tipX - CENTER) * 180 / Math.PI})`"
            :fill="arr.color"
            :opacity="arr.tipZ > 0 ? 1 : 0.4"
          />
        </g>

        <!-- Light indicator: a sun/key-light glyph at the orbit position. A
             translucent beam shows the light throw toward the subject. Primary
             control — drag to aim the light (azimuth + elevation). Sits ABOVE
             the rings in z so it's always grabbable. -->
        <g>
          <title>Key light</title>
          <!-- Throw tether: faint dashed line subject→light (depth cue). -->
          <line
            :x1="cameraIndicator.fromX" :y1="cameraIndicator.fromY"
            :x2="cameraIndicator.x"     :y2="cameraIndicator.y"
            stroke="rgba(255,255,255,0.22)"
            stroke-width="1"
            stroke-dasharray="2 4"
            style="pointer-events: none;"
          />
          <g
            :transform="`translate(${cameraIndicator.x}, ${cameraIndicator.y}) rotate(${cameraIndicator.angle}) scale(1, ${cameraIndicator.flip})`"
            :style="{ cursor: drag && drag.kind === 'camera' ? 'grabbing' : 'grab', opacity: cameraIndicator.z > 0 ? 1 : 0.6 }"
            aria-label="light source"
            @pointerdown="onCameraPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <!-- Generous hit target (rotation-invariant). -->
            <circle r="22" fill="transparent" />
            <!-- Dark separation halo so the amber sun reads against BOTH light
                 and dark imagery. -->
            <circle r="15" fill="rgba(0,0,0,0.55)" />
            <!-- Light beam toward the subject (+X). Bright amber wedge. -->
            <path d="M6,0 L26,-10 L26,10 Z" fill="#fbbf24" opacity="0.28" />
            <!-- Soft outer glow. -->
            <circle r="9.5" fill="#fbbf24" opacity="0.22" />
            <!-- Sun rays: 8 short spokes around the core. -->
            <g stroke="#fbbf24" stroke-width="1.6" stroke-linecap="round">
              <line x1="0" y1="-9.5" x2="0" y2="-6" />
              <line x1="0" y1="9.5"  x2="0" y2="6" />
              <line x1="-9.5" y1="0" x2="-6" y2="0" />
              <line x1="9.5" y1="0"  x2="6" y2="0" />
              <line x1="-6.7" y1="-6.7" x2="-4.2" y2="-4.2" />
              <line x1="6.7" y1="-6.7"  x2="4.2" y2="-4.2" />
              <line x1="-6.7" y1="6.7"  x2="-4.2" y2="4.2" />
              <line x1="6.7" y1="6.7"   x2="4.2" y2="4.2" />
            </g>
            <!-- Sun core: bright amber disc with a dark outline + warm glint. -->
            <circle r="5" fill="#fbbf24" stroke="rgba(0,0,0,0.85)" stroke-width="1.4" />
            <circle cx="-1.4" cy="-1.4" r="1.6" fill="#fde68a" />
          </g>
        </g>

        <!-- Handles. Each handle has a big invisible hit circle (~18px radius)
             for easy grabbing, a soft glow halo, and a hex body that scales up
             when hovered or actively dragged. Back-facing handles dim slightly
             but stay clickable so users can grab a handle that wraps around. -->
        <g>
          <g
            v-for="h in handles"
            :key="`handle-${h.axis}`"
            :transform="`translate(${h.x}, ${h.y})`"
            :style="{ cursor: drag && drag.kind === 'handle' ? 'grabbing' : 'grab', opacity: h.z > 0 ? 1 : 0.55 }"
            @pointerdown="(e) => onHandlePointerDown(e, h.axis)"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
            @pointerenter="hoveredAxis = h.axis"
            @pointerleave="hoveredAxis = null"
          >
            <!-- Generous transparent hit target. Bigger than the visible
                 handle so missed clicks are rare. -->
            <circle r="18" fill="transparent" />
            <!-- Soft glow halo. Larger when active for emphasis. -->
            <circle
              :r="activeAxis === h.axis ? 16 : (h.z > 0 ? 11 : 9)"
              :fill="AXIS_COLORS[h.axis]"
              :opacity="activeAxis === h.axis ? 0.32 : 0.18"
            />
            <!-- Hex body. Bigger + white-ringed when active. -->
            <polygon
              :points="hexPoints(activeAxis === h.axis ? 9 : (h.z > 0 ? 7 : 5.5))"
              :fill="AXIS_COLORS[h.axis]"
              :stroke="activeAxis === h.axis ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.9)'"
              :stroke-width="activeAxis === h.axis ? 1.8 : 1.4"
            />
          </g>
        </g>
      </svg>
    </div>

    <!-- Intensity slider: 0..1 key-light strength. Neutral white-opacity. -->
    <div class="lg-intensity">
      <span class="lg-intensity__label">Intensity</span>
      <input
        type="range" min="0" max="1" step="0.01"
        :value="intensity"
        @input="intensity = +($event.target as HTMLInputElement).value; commit()"
      />
    </div>

    <!-- Phrase caption — what's about to be sent to nano-banana-2. -->
    <div class="camera-gimbal__phrase" :title="phrase">{{ phrase }}</div>
    <div class="camera-gimbal__readout">{{ readout }}</div>

    <!-- Preset bar + reset. Quick jumps to canonical light directions. -->
    <div class="camera-gimbal__presets">
      <button
        v-for="p in PRESETS"
        :key="p.label"
        type="button"
        class="camera-gimbal__preset"
        :title="`azimuth ${p.yaw}° · elevation ${p.pitch}°`"
        @click="applyPreset(p)"
      >{{ p.label }}</button>
      <button
        type="button"
        class="camera-gimbal__preset camera-gimbal__preset--reset"
        title="Reset light to front, 60% intensity"
        @click="resetAll"
      >
        <RotateCcw class="w-3 h-3" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.camera-gimbal {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px 0 8px;
  user-select: none;
}
.camera-gimbal__label {
  font-size: 10.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.02em;
}
.camera-gimbal__stage {
  position: relative;
  display: flex;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 35%, rgba(255, 255, 255, 0.04), transparent 70%);
  border-radius: 8px;
  padding: 6px 0;
  /* Perspective makes CSS 3D rotations look like actual 3D rotations instead
     of flat skews. ~700px feels right for our 240px stage — visible depth
     without fisheye distortion. */
  perspective: 700px;
}

/* Subject image: absolutely-positioned center container with a fixed
   square plane rotated by the user's angles. The plane is sized to fit
   comfortably *inside* the gimbal rings (RADIUS=92 in SVG units; the SVG
   is 240 wide; we render a ~130px plane to leave the rings visible). */
.camera-gimbal__subject {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;        /* clicks pass through to the gimbal */
  transform-style: preserve-3d;
}
.camera-gimbal__subject-plane {
  width: 130px;
  height: 130px;
  transform-style: preserve-3d;
  transition: transform 60ms linear;   /* smooths out brute-force-search jitter */
}
.camera-gimbal__subject-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.55);
  /* When rotated past 90°, the browser shows the mirror-image of the back of
     the plane. That actually reads correctly: "I've spun the subject around,
     so I see its mirrored back." Leave on. */
  backface-visibility: visible;
  /* Slight desaturation + dim so it doesn't compete with the rings visually. */
  filter: saturate(0.85) brightness(0.92);
}
.camera-gimbal__subject-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.35);
  font-size: 10.5px;
  text-align: center;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.02);
}

.camera-gimbal__svg {
  display: block;
  touch-action: none;     /* let us own touch gestures */
  position: relative;     /* sit above the subject layer in z-order */
  z-index: 1;
  overflow: visible;      /* let the floated camera glyph draw past the edge */
}
.camera-gimbal__phrase {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.88);
  text-align: center;
  font-style: italic;
  padding: 0 6px;
  line-height: 1.35;
  min-height: 1.35em;
}
.camera-gimbal__readout {
  font-size: 9.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(255, 255, 255, 0.4);
  text-align: center;
  letter-spacing: 0.02em;
}
.camera-gimbal__presets {
  display: flex;
  gap: 4px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 2px;
}
.camera-gimbal__preset {
  font-size: 10.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  padding: 3px 8px;
  cursor: pointer;
  transition: background 80ms, color 80ms, border-color 80ms;
}
.camera-gimbal__preset:hover {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
  border-color: rgba(255, 255, 255, 0.18);
}
.camera-gimbal__preset--reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 6px;
}

/* Intensity slider — neutral white-opacity to match the widget; no accent hue. */
.lg-intensity { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.lg-intensity__label { font-size: 11px; opacity: 0.7; }
.lg-intensity input { flex: 1; accent-color: rgba(255,255,255,0.8); }
</style>
