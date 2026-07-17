// Off-screen bake of the three output passes. Renders from the COMMITTED doc
// camera (not the live orbit view) at the doc's output resolution, on a
// temporary canvas so the viewport is untouched.
//
// Depth convention: near = white, far = black, background = black (ControlNet
// style), with near/far fitted to the scene bounds so the ramp is well spread.
import * as THREE from 'three'
import type { SceneDoc } from './config'
import type { SceneEngine } from './engine'

export function fitNearFar(bounds: THREE.Box3, camPos: THREE.Vector3): { near: number; far: number } {
  if (bounds.isEmpty()) return { near: 0.1, far: 100 }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  const dist = camPos.distanceTo(sphere.center)
  const near = Math.max(0.05, dist - sphere.radius * 1.05)
  let far = Math.max(0.2, dist + sphere.radius * 1.05)
  // Degenerate (zero-radius) bounds would give near === far → divide-by-zero
  // in the depth ramp shader. Keep a minimum spread.
  if (far - near < 1e-3) far = near + 1
  return { near, far }
}

const depthMaterial = () => new THREE.ShaderMaterial({
  uniforms: { uNear: { value: 0.1 }, uFar: { value: 100 } },
  vertexShader: /* glsl */ `
    varying float vViewZ;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewZ = -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform float uNear; uniform float uFar;
    varying float vViewZ;
    void main() {
      float d = clamp((uFar - vViewZ) / (uFar - uNear), 0.0, 1.0);
      gl_FragColor = vec4(vec3(d), 1.0);
    }`,
})

export async function renderPasses(engine: SceneEngine, doc: SceneDoc):
  Promise<{ beauty: string; depth: string; normal: string }> {
  const { width, height } = doc.output
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(width, height, false)
  renderer.setPixelRatio(1)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const camera = new THREE.PerspectiveCamera(doc.camera.fov, width / height, 0.1, 200)
  camera.position.set(...doc.camera.position)
  camera.lookAt(...doc.camera.target)

  const scene = engine.scene
  const prevBg = scene.background
  const prevOverride = scene.overrideMaterial
  const prevGrid = engine.grid.visible
  const prevGround = engine.shadowGround.visible
  engine.grid.visible = false
  // Editor-only helpers (the TransformControls gizmo) live in the same scene;
  // hide them so an active selection's gizmo never bleeds into the baked passes
  // — otherwise its arrows show in beauty and register as fake geometry in the
  // depth/normal ControlNet maps.
  const helpers = engine.scene.children.filter((c) => c.userData.isGizmoHelper && c.visible)
  for (const h of helpers) h.visible = false
  let dmat: THREE.ShaderMaterial | null = null
  let nmat: THREE.MeshNormalMaterial | null = null
  try {
    // Beauty — scene as styled, with the same filmic tone mapping + contact
    // shadow as the live viewport. Transparent background stays transparent.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.1
    scene.background = doc.background === 'transparent' ? null : new THREE.Color(doc.background)
    renderer.render(scene, camera)
    const beauty = canvas.toDataURL('image/png')

    // Data passes must be raw: tone mapping would corrupt the normal colours and
    // depth ramp, and the shadow catcher would render as a floor in both maps.
    renderer.toneMapping = THREE.NoToneMapping
    engine.shadowGround.visible = false

    // Depth — custom near-white ramp fitted to the visible objects.
    const bounds = new THREE.Box3()
    for (const root of engine.objectRoots.values()) if (root.visible) bounds.expandByObject(root)
    const { near, far } = fitNearFar(bounds, camera.position)
    dmat = depthMaterial()
    dmat.uniforms.uNear!.value = near
    dmat.uniforms.uFar!.value = far
    scene.background = new THREE.Color(0x000000)
    scene.overrideMaterial = dmat
    renderer.render(scene, camera)
    const depth = canvas.toDataURL('image/png')

    // Normal — three's built-in view-space normal material, neutral background.
    nmat = new THREE.MeshNormalMaterial()
    scene.background = new THREE.Color('#8080ff')
    scene.overrideMaterial = nmat
    renderer.render(scene, camera)
    const normal = canvas.toDataURL('image/png')

    return { beauty, depth, normal }
  } finally {
    scene.overrideMaterial = prevOverride
    scene.background = prevBg
    engine.grid.visible = prevGrid
    engine.shadowGround.visible = prevGround
    for (const h of helpers) h.visible = true
    dmat?.dispose()
    nmat?.dispose()
    renderer.dispose()
    // dispose() alone never releases the GL context; without this, repeated
    // bakes on fresh detached canvases exhaust the browser's context cap.
    renderer.forceContextLoss()
  }
}
