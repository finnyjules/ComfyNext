import type { SpaceTypeEffect } from '../effect'
import { ribbonEffect } from './ribbon'
import { stripesEffect } from './stripes'
import { cylinderEffect } from './cylinder'
import { fieldEffect } from './field'
import { coilEffect } from './coil'

/** All registered Space Type effects, in picker order. Add new effect modules here. */
export const SPACE_TYPE_EFFECTS: SpaceTypeEffect[] = [
  ribbonEffect,
  stripesEffect,
  cylinderEffect,
  fieldEffect,
  coilEffect,
]

export function getEffect(id: string): SpaceTypeEffect {
  return SPACE_TYPE_EFFECTS.find(e => e.id === id) ?? SPACE_TYPE_EFFECTS[0]!
}
