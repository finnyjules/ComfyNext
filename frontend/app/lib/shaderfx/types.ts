export interface EffectParamDef {
  uniform: string
  label: string
  type: 'float'
  min: number
  max: number
  default: number
  step: number
}

export interface EffectTextureDef {
  uniform: string
  file: string
  extraUniforms?: Record<string, number>
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
