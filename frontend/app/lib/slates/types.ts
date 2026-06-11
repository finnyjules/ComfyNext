// frontend/app/lib/slates/types.ts
/**
 * Slate templates — data-only definitions of LIV-style motion compositions.
 * Layer defs carry tokens: `{{ brand.<key> }}` (resolved from the project's
 * active brand kit via effectiveBrand) and `{{ props.<slotKey> }}` (user text
 * slots). instantiate.ts resolves them into plain LocalLayers + FrameMotion —
 * a placed slate is an ordinary editable Frame with concrete values.
 */
import type { LayerAnimation, FrameMotion } from '~/lib/motion/types'

/** Gradient def whose stop colors may be tokens. */
export interface SlateGradientDef {
  type: 'linear' | 'radial'
  angle?: number
  stops: { offset: number; color: string }[]
}
export type SlatePaintDef = string | SlateGradientDef

interface SlateLayerCommon {
  /** Template-local reference key — mask bindings use this, instantiation maps it to a real layer id. */
  ref: string
  x: number; y: number
  rotation?: number
  opacity?: number
  /** Clip this layer to another def's silhouette (by ref). */
  maskedByRef?: string
  animation?: LayerAnimation
}

export interface SlateTextDef extends SlateLayerCommon {
  kind: 'text'
  text: string            // may contain {{ props.* }} / {{ brand.* }} tokens
  fontFamily: string      // may be a {{ brand.fontDisplay }} token
  fontWeight: number
  fontSize: number
  color: string           // may be a token
  align?: 'left' | 'center' | 'right'
  lineHeight?: number
  strokeColor?: string
  strokeWidth?: number
}

export interface SlateRectDef extends SlateLayerCommon {
  kind: 'rect'
  w: number; h: number
  radius?: number
  fill: SlatePaintDef
}

export interface SlateMediaDef extends SlateLayerCommon {
  kind: 'media'
  /** Media slot key — the gallery fills it with an uploaded image filename. */
  slot: string
  w: number; h: number
  /** Fallback when the slot is unfilled: a rect with this fill stands in. */
  fallbackFill: SlatePaintDef
}

export type SlateLayerDef = SlateTextDef | SlateRectDef | SlateMediaDef

export interface SlateTextSlot { key: string; label: string; default: string }
export interface SlateMediaSlot { key: string; label: string }

export interface SlateTemplate {
  id: string
  label: string
  pitch: string           // one-line description for the gallery card
  motion: FrameMotion
  textSlots: SlateTextSlot[]
  mediaSlots: SlateMediaSlot[]
  layers: SlateLayerDef[]
  /** Three colors for the gallery card thumbnail (token strings). */
  thumb: [string, string, string]
}

export interface SlateMediaFill { filename: string; aspect: number }

export interface InstantiateOptions {
  brand: import('~~/shared/brand/types').BrandKit
  texts: Record<string, string>
  media?: Record<string, SlateMediaFill>
}
