export interface EffectParamDef {
  uniform: string
  label: string
  type: 'float' | 'enum'
  min?: number
  max?: number
  default: number
  step?: number
  options?: { label: string; value: number }[]
}

export interface EffectTextureDef {
  uniform: string
  file: string
  extraUniforms?: Record<string, number>
  /** content version (asset mtime) for cache-busting the asset URL */
  v?: string
}

export interface EffectDef {
  id: string
  name: string
  category: string
  animated: boolean
  passes: number
  centerParam: string[] | null
  textures: EffectTextureDef[]
  params: EffectParamDef[]
  source: string
  generative?: boolean
}

export interface ShaderFxCatalog {
  version: number
  effects: EffectDef[]
}
