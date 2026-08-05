import type { Component } from 'vue'
import RowSlider from './RowSlider.vue'

/**
 * kind → the component that draws the VALUE side of a row. The row shell
 * (StudioRow.vue) draws everything else, so a renderer never repeats the label,
 * the glyph or the fill. Adding a kind is one component plus one line here.
 */
export const rowRenderers: Record<string, Component> = {
  slider: RowSlider,
}

/** Kinds whose value is a number the row itself can drag and type into. */
export const NUMERIC_KINDS = new Set(['slider'])
