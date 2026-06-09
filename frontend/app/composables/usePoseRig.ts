/**
 * Procedural artist-mannequin rig for the Pose node's 3D editor.
 *
 * No external GLB: the figure is built from capsule/sphere primitives parented
 * into a bone hierarchy, so it's tiny, license-free, and every joint maps to a
 * known name. The render this produces is the *conditioning image* fed to
 * nano-banana (see /api/inpaint/pose) — it reads it as a gray mannequin showing
 * the target pose, exactly as the de-risking spike proved.
 *
 * This module is THREE-agnostic on purpose (no top-level `import 'three'`) so it
 * stays SSR-safe; the editor passes the dynamically-imported THREE namespace in.
 */

export type Vec3 = [number, number, number]

export interface BoneDef {
  /** Unique joint name; also the key used in serialized pose state. */
  name: string
  /** Parent joint name, or null for the root (hips). */
  parent: string | null
  /** Rest position of this joint relative to its parent joint, in parent space. */
  offset: Vec3
  /** Capsule radius for the bone segment drawn parent→this. 0 = no segment. */
  radius: number
  /** Optional sphere radius drawn AT this joint (head, hands, feet). */
  ball?: number
  /** Whether this joint is user-rotatable (gets a selectable handle). */
  rotatable?: boolean
}

// Character stands at the origin, faces +Z (toward the camera), Y up.
// Heights are in metres; feet land near y = 0 once the root is lifted (see
// MANNEQUIN_LIFT). Signs of X put the character's right limb on +X.
export const BONES: BoneDef[] = [
  { name: 'hips',      parent: null,     offset: [0, 0, 0],          radius: 0.10, rotatable: true },
  { name: 'spine',     parent: 'hips',   offset: [0, 0.18, 0],       radius: 0.095, rotatable: true },
  { name: 'chest',     parent: 'spine',  offset: [0, 0.20, 0],       radius: 0.105, rotatable: true },
  { name: 'neck',      parent: 'chest',  offset: [0, 0.22, 0],       radius: 0.045, rotatable: true },
  { name: 'head',      parent: 'neck',   offset: [0, 0.10, 0],       radius: 0.0,  ball: 0.115, rotatable: true },

  // Right arm (character's right → +X). Rest: arms hang down at the sides.
  { name: 'shoulderR', parent: 'chest',  offset: [0.17, 0.15, 0],    radius: 0.052, rotatable: true },
  { name: 'elbowR',    parent: 'shoulderR', offset: [0.04, -0.27, 0], radius: 0.044, rotatable: true },
  // Distal joints carry the *segment* radius (forearm) so the bone to them
  // draws; `ball` adds the hand on top.
  { name: 'wristR',    parent: 'elbowR', offset: [0.02, -0.25, 0],   radius: 0.04, ball: 0.05, rotatable: true },

  // Left arm (−X).
  { name: 'shoulderL', parent: 'chest',  offset: [-0.17, 0.15, 0],   radius: 0.052, rotatable: true },
  { name: 'elbowL',    parent: 'shoulderL', offset: [-0.04, -0.27, 0], radius: 0.044, rotatable: true },
  { name: 'wristL',    parent: 'elbowL', offset: [-0.02, -0.25, 0],  radius: 0.04, ball: 0.05, rotatable: true },

  // Right leg.
  { name: 'hipR',      parent: 'hips',   offset: [0.10, -0.06, 0],   radius: 0.072, rotatable: true },
  { name: 'kneeR',     parent: 'hipR',   offset: [0, -0.45, 0],      radius: 0.056, rotatable: true },
  // Ankle carries the shin radius so the lower-leg bone draws; foot is its child.
  { name: 'ankleR',    parent: 'kneeR',  offset: [0, -0.43, 0],      radius: 0.05, rotatable: true },
  { name: 'footR',     parent: 'ankleR', offset: [0, -0.05, 0.12],   radius: 0.05 },

  // Left leg.
  { name: 'hipL',      parent: 'hips',   offset: [-0.10, -0.06, 0],  radius: 0.072, rotatable: true },
  { name: 'kneeL',     parent: 'hipL',   offset: [0, -0.45, 0],      radius: 0.056, rotatable: true },
  { name: 'ankleL',    parent: 'kneeL',  offset: [0, -0.43, 0],      radius: 0.05, rotatable: true },
  { name: 'footL',     parent: 'ankleL', offset: [0, -0.05, 0.12],   radius: 0.05 },
]

/** Lift applied to the root so the feet rest near the ground plane. */
export const MANNEQUIN_LIFT = 0.94

export type PoseRotations = Record<string, Vec3>

export interface PoseState {
  rotations: PoseRotations
  /** Camera orbit, persisted so reopening the editor restores the framing. */
  camera?: { position: Vec3; target: Vec3 }
}

const D = Math.PI / 180

// Preset poses = starting points the user then refines with FK. Only non-zero
// joint rotations are listed; everything else stays at its rest angle.
export const POSE_PRESETS: Record<string, PoseRotations> = {
  Stand: {},
  'T-pose': {
    shoulderR: [0, 0, 90 * D],
    shoulderL: [0, 0, -90 * D],
  },
  // Neutral pose for 3D/rigging: limbs clearly separated from the body but
  // natural. The starting point for the "3D views" multi-view capture.
  'A-pose': {
    shoulderR: [0, 0, 48 * D], shoulderL: [0, 0, -48 * D],
    hipR: [0, 0, -8 * D], hipL: [0, 0, 8 * D],
  },
  Wave: {
    shoulderR: [0, 0, 145 * D],
    elbowR: [0, 0, 35 * D],
    shoulderL: [0, 0, -8 * D],
  },
  Walk: {
    shoulderR: [-22 * D, 0, 4 * D],
    elbowR: [-18 * D, 0, 0],
    shoulderL: [24 * D, 0, -4 * D],
    elbowL: [-15 * D, 0, 0],
    hipR: [26 * D, 0, 0],
    kneeR: [-12 * D, 0, 0],
    hipL: [-28 * D, 0, 0],
    kneeL: [40 * D, 0, 0],
    spine: [4 * D, 0, 0],
  },
  Sitting: {
    hipR: [-92 * D, 0, 3 * D],
    kneeR: [95 * D, 0, 0],
    hipL: [-92 * D, 0, -3 * D],
    kneeL: [95 * D, 0, 0],
    shoulderR: [12 * D, 0, 6 * D],
    shoulderL: [12 * D, 0, -6 * D],
  },
  Cheer: {
    shoulderR: [0, 0, 165 * D],
    shoulderL: [0, 0, -165 * D],
    spine: [-6 * D, 0, 0],
  },
  Running: {
    spine: [-10 * D, 0, 0],
    shoulderR: [-48 * D, 0, 8 * D], elbowR: [-95 * D, 0, 0],
    shoulderL: [42 * D, 0, -8 * D], elbowL: [-95 * D, 0, 0],
    hipR: [42 * D, 0, 0], kneeR: [55 * D, 0, 0],
    hipL: [-55 * D, 0, 0], kneeL: [20 * D, 0, 0],
  },
  Jumping: {
    spine: [-5 * D, 0, 0],
    shoulderR: [0, 0, 158 * D], shoulderL: [0, 0, -158 * D],
    hipR: [-38 * D, 0, 6 * D], kneeR: [68 * D, 0, 0],
    hipL: [-38 * D, 0, -6 * D], kneeL: [68 * D, 0, 0],
  },
  Crouch: {
    spine: [-22 * D, 0, 0],
    hipR: [-95 * D, 0, 6 * D], kneeR: [115 * D, 0, 0],
    hipL: [-95 * D, 0, -6 * D], kneeL: [115 * D, 0, 0],
    shoulderR: [-42 * D, 0, 8 * D], shoulderL: [-42 * D, 0, -8 * D],
  },
  Kick: {
    hipR: [-78 * D, 0, 0], kneeR: [18 * D, 0, 0],
    hipL: [8 * D, 0, 0], kneeL: [10 * D, 0, 0],
    shoulderR: [0, 0, 55 * D], shoulderL: [0, 0, -70 * D],
    spine: [-6 * D, 0, 0],
  },
  Pointing: {
    shoulderR: [-82 * D, 0, 6 * D], elbowR: [0, 0, 0],
    shoulderL: [6 * D, 0, -4 * D],
  },
  'Arms crossed': {
    shoulderR: [-26 * D, 0, 14 * D], elbowR: [-118 * D, 0, -18 * D],
    shoulderL: [-26 * D, 0, -14 * D], elbowL: [-118 * D, 0, 18 * D],
  },
}

export interface MannequinHandles {
  root: any // THREE.Group
  joints: Record<string, any> // name → THREE.Object3D (the rotatable joint)
  handleMeshes: any[] // small spheres for raycast selection (userData.joint = name)
  pickables: any[] // every body mesh, each tagged userData.joint = controlling joint
}

/**
 * Build the mannequin under a root Group. Each rotatable joint is an Object3D
 * positioned at its rest offset; bone capsules and handle spheres are attached
 * so rotating a joint swings its segment and all descendants (forward kinematics).
 */
export function buildMannequin(THREE: any): MannequinHandles {
  const root = new THREE.Group()
  root.position.y = MANNEQUIN_LIFT

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.72, metalness: 0.0 })
  const handleMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55, depthTest: false })

  const joints: Record<string, any> = {}
  const handleMeshes: any[] = []
  const pickables: any[] = []

  // The joint that *controls* a given bone's segment: rotating it swings the
  // segment. For a segment parent→this, that's the parent; if the parent isn't
  // rotatable, walk up until one is.
  const controllerOf = (name: string | null): string | null => {
    let n = name
    while (n) {
      const b = BONES.find(x => x.name === n)
      if (b?.rotatable) return n
      n = b?.parent ?? null
    }
    return null
  }

  for (const bone of BONES) {
    const joint = new THREE.Object3D()
    joint.name = bone.name
    joint.position.set(...bone.offset)
    joint.userData.rest = [...bone.offset]
    ;(bone.parent ? joints[bone.parent] : root).add(joint)
    joints[bone.name] = joint

    // Bone segment: a capsule from the PARENT joint to this joint, attached to
    // the parent so it swings when the parent rotates. Clicking it selects the
    // parent (the joint that moves it).
    if (bone.parent && bone.radius > 0) {
      const len = Math.hypot(...bone.offset)
      if (len > 1e-4) {
        const cap = new THREE.Mesh(
          new THREE.CapsuleGeometry(bone.radius, Math.max(0.001, len - bone.radius * 1.2), 6, 12),
          bodyMat,
        )
        // Capsule's long axis is +Y; orient it along the offset direction.
        const dir = new THREE.Vector3(...bone.offset).normalize()
        cap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
        cap.position.set(bone.offset[0] / 2, bone.offset[1] / 2, bone.offset[2] / 2)
        cap.userData.joint = controllerOf(bone.parent)
        joints[bone.parent].add(cap)
        if (cap.userData.joint) pickables.push(cap)
      }
    }

    // Joint ball (head, hands) — clicking it selects this joint.
    if (bone.ball && bone.ball > 0) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(bone.ball, 16, 12), bodyMat)
      ball.userData.joint = controllerOf(bone.name)
      joint.add(ball)
      if (ball.userData.joint) pickables.push(ball)
    }

    // Facing cue on the head: a nose + two dark eyes on the front (+Z). A
    // featureless blob hides which way the figure faces, so the AI can't follow
    // body rotation. A clear face makes orientation legible in the baked render.
    if (bone.name === 'head' && bone.ball) {
      const R = bone.ball
      const nose = new THREE.Mesh(new THREE.ConeGeometry(R * 0.32, R * 0.6, 14), bodyMat)
      nose.rotation.x = Math.PI / 2 // cone apex +Y → point it +Z (forward)
      nose.position.set(0, -R * 0.05, R * 0.92)
      nose.userData.joint = 'head'
      joint.add(nose); pickables.push(nose)
      const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.5 })
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(R * 0.16, 10, 8), eyeMat)
        eye.position.set(sx * R * 0.38, R * 0.18, R * 0.86)
        eye.userData.joint = 'head'
        joint.add(eye); pickables.push(eye)
      }
    }

    // Selectable handle (only rotatable joints) — larger + always-on-top so the
    // joints are easy to grab.
    if (bone.rotatable) {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), handleMat)
      h.renderOrder = 999
      h.userData.joint = bone.name
      joint.add(h)
      handleMeshes.push(h)
      pickables.push(h)
    }
  }

  return { root, joints, handleMeshes, pickables }
}

/** Apply serialized rotations to the live joints (missing joints → rest = 0). */
export function applyRotations(joints: Record<string, any>, rotations: PoseRotations) {
  for (const bone of BONES) {
    const j = joints[bone.name]
    if (!j) continue
    const r = rotations[bone.name] || [0, 0, 0]
    j.rotation.set(r[0], r[1], r[2])
  }
}

/** Read the current joint rotations into a plain serializable map. */
export function serializeRotations(joints: Record<string, any>): PoseRotations {
  const out: PoseRotations = {}
  for (const bone of BONES) {
    const j = joints[bone.name]
    if (!j) continue
    const e = j.rotation
    // Skip rest joints to keep the payload small.
    if (Math.abs(e.x) < 1e-4 && Math.abs(e.y) < 1e-4 && Math.abs(e.z) < 1e-4) continue
    out[bone.name] = [e.x, e.y, e.z]
  }
  return out
}
