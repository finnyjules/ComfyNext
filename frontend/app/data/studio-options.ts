// Studios — places you open and craft in (IA spec §1: defined by interaction
// model, not AI-ness). Single source for BOTH the toolbar Studios door and
// the start modal's "Craft it by hand" row — they must never drift.
// pastel = the studio bills AI credits when run.
import type { Component } from 'vue'
import { Blend, Aperture, Grid3x3, Gem, Box, CaseSensitive, Clapperboard, AudioWaveform } from 'lucide-vue-next'
import { SPACE_TYPE_ENABLED } from '~/lib/spaceTypeEnabled'

export interface StudioOption {
  label: string
  icon: Component
  nodeType?: string
  special?: string
  pastel?: boolean
}

export const STUDIO_OPTIONS: StudioOption[] = [
  ...(SPACE_TYPE_ENABLED ? [{ label: 'Type', icon: CaseSensitive, special: 'space-type' }] : []),
  { label: 'Gradient', icon: Blend, nodeType: 'GradientStudio' },
  { label: 'Shader', icon: Aperture, nodeType: 'ShaderStudio' },
  { label: 'Pattern', icon: Grid3x3, nodeType: 'TextureStudio' },
  { label: 'Shape', icon: Gem, nodeType: 'ShapeStudio' },
  { label: '3D', icon: Box, nodeType: 'Scene3DStudio' },
  { label: 'Shot Director', icon: Clapperboard, nodeType: 'ShotDirector', pastel: true },
  { label: 'Lip-Sync', icon: AudioWaveform, nodeType: 'LipSyncStudio', pastel: true },
]
