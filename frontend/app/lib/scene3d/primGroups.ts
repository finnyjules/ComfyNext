// Menu grouping/labels/icons for the 3D Studio add-menu. Kinds must cover every
// PLACEABLE PRIMITIVE_KINDS entry exactly (unit-tested in scene3d-config.unit.spec.ts).
// `svgPath` is deliberately absent — see NOT_PLACEABLE_KINDS in config.ts: it has
// no blank form to place, it only ever arrives carrying imported path data.
import type { Component } from 'vue'
import {
  Box, Circle, Cylinder, Cone, Torus, Square, Pill, Pyramid, Triangle, Gem, Diamond,
  Hexagon, CircleDashed, Infinity as InfinityIcon, Type,
} from 'lucide-vue-next'
import type { PrimitiveKind } from './config'

export interface PrimGroupItem { kind: PrimitiveKind; label: string; icon: Component }

// Menu groups (spec order). Icons are real lucide glyphs where they exist,
// nearest-match otherwise — all names verified against the installed
// lucide-vue-next export list.
export const PRIM_GROUPS: { label: string; kinds: PrimGroupItem[] }[] = [
  { label: 'Basics', kinds: [
    { kind: 'box', label: 'Box', icon: Box },
    { kind: 'sphere', label: 'Sphere', icon: Circle },
    { kind: 'cylinder', label: 'Cylinder', icon: Cylinder },
    { kind: 'cone', label: 'Cone', icon: Cone },
    { kind: 'torus', label: 'Torus', icon: Torus },
    { kind: 'plane', label: 'Plane', icon: Square },
  ] },
  { label: 'Solids', kinds: [
    { kind: 'capsule', label: 'Capsule', icon: Pill },
    { kind: 'pyramid', label: 'Pyramid', icon: Pyramid },
    { kind: 'prism', label: 'Prism', icon: Triangle },
  ] },
  { label: 'Polyhedra', kinds: [
    { kind: 'icosahedron', label: 'Icosahedron', icon: Gem },
    { kind: 'octahedron', label: 'Octahedron', icon: Diamond },
    { kind: 'dodecahedron', label: 'Dodecahedron', icon: Hexagon },
  ] },
  { label: 'Decorative', kinds: [
    { kind: 'torusKnot', label: 'Torus knot', icon: InfinityIcon },
    { kind: 'ring', label: 'Ring', icon: CircleDashed },
  ] },
  { label: 'Text & Shape', kinds: [
    { kind: 'text', label: 'Text', icon: Type },
    { kind: 'shape', label: 'Shape', icon: Hexagon },
  ] },
]
