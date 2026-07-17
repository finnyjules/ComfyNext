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
  return {
    near: Math.max(0.05, dist - sphere.radius * 1.05),
    far: Math.max(0.2, dist + sphere.radius * 1.05),
  }
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
  const prevGrid = engine.grid.visible
  engine.grid.visible = false
  try {
    // Beauty — scene as styled. Transparent background stays transparent (alpha).
    scene.background = doc.background === 'transparent' ? null : new THREE.Color(doc.background)
    renderer.render(scene, camera)
    const beauty = canvas.toDataURL('image/png')

    // Depth — custom near-white ramp fitted to the visible objects.
    const bounds = new THREE.Box3()
    for (const root of engine.objectRoots.values()) if (root.visible) bounds.expandByObject(root)
    const { near, far } = fitNearFar(bounds, camera.position)
    const dmat = depthMaterial()
    dmat.uniforms.uNear!.value = near
    dmat.uniforms.uFar!.value = far
    scene.background = new THREE.Color(0x000000)
    scene.overrideMaterial = dmat
    renderer.render(scene, camera)
    const depth = canvas.toDataURL('image/png')

    // Normal — three's built-in view-space normal material, neutral background.
    scene.background = new THREE.Color('#8080ff')
    scene.overrideMaterial = new THREE.MeshNormalMaterial()
    renderer.render(scene, camera)
    const normal = canvas.toDataURL('image/png')

    return { beauty, depth, normal }
  } finally {
    scene.overrideMaterial = null
    scene.background = prevBg
    engine.grid.visible = prevGrid
    renderer.dispose()
  }
}
