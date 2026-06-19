import type { SpaceTypeEffect } from '../effect'
import { ribbonEffect } from './ribbon'
import { stripesEffect } from './stripes'
import { cylinderEffect } from './cylinder'
import { fieldEffect } from './field'
import { coilEffect } from './coil'
import { cascadeEffect } from './cascade'
import { boostEffect } from './boost'
import { meltEffect } from './melt'
import { onionburstEffect } from './onionburst'
import { elasticEffect } from './elastic'
import { stringEffect } from './string'
import { blendEffect } from './blend'
import { echoEffect } from './echo'
import { sliceGlitchEffect } from './sliceGlitch'

/** All registered Space Type effects, in picker order. Add new effect modules here. */
export const SPACE_TYPE_EFFECTS: SpaceTypeEffect[] = [
  ribbonEffect,
  stripesEffect,
  cylinderEffect,
  fieldEffect,
  coilEffect,
  cascadeEffect,
  boostEffect,
  meltEffect,
  onionburstEffect,
  elasticEffect,
  stringEffect,
  blendEffect,
  echoEffect,
  sliceGlitchEffect,
]

export function getEffect(id: string): SpaceTypeEffect {
  return SPACE_TYPE_EFFECTS.find(e => e.id === id) ?? SPACE_TYPE_EFFECTS[0]!
}
