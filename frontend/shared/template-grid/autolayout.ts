/** Pure single-axis flexbox solver for auto-layout Stacks. Works entirely in
 * px — the caller (resolver) converts fine-grid cell units to px and measures
 * text/intrinsic sizes before calling. No grid, text, or DOM dependency. */

import type { Rect } from './grid'
import type { CrossAlign, LayoutAxis, MainAlign, SizeMode } from './types'

export interface StackItem {
  id: string
  /** Intrinsic main-axis extent (px) for hug/fixed; ignored for fill. */
  main: number
  /** Intrinsic cross-axis extent (px) for non-stretch cross modes. */
  cross: number
  mainMode: SizeMode
  crossMode: SizeMode
}

export interface StackBox {
  x: number; y: number; w: number; h: number
  direction: LayoutAxis
  padTop: number; padRight: number; padBottom: number; padLeft: number
  gap: number
  mainAlign: MainAlign
  crossAlign: CrossAlign
}

export function solveStack(box: StackBox, items: StackItem[]): Array<{ id: string; rect: Rect }> {
  if (!items.length) return []
  const horiz = box.direction === 'horizontal'
  const innerX = box.x + box.padLeft
  const innerY = box.y + box.padTop
  const innerW = Math.max(0, box.w - box.padLeft - box.padRight)
  const innerH = Math.max(0, box.h - box.padTop - box.padBottom)
  const mainTotal = horiz ? innerW : innerH
  const crossTotal = horiz ? innerH : innerW
  const crossOrigin = horiz ? innerY : innerX

  const n = items.length
  const fillCount = items.filter(i => i.mainMode === 'fill').length
  const fixedHugSum = items.filter(i => i.mainMode !== 'fill').reduce((s, i) => s + i.main, 0)
  const gapsTotal = box.gap * (n - 1)
  const leftover = mainTotal - fixedHugSum - gapsTotal
  const fillEach = fillCount ? Math.max(0, leftover / fillCount) : 0

  const mainExtent = (i: StackItem) => (i.mainMode === 'fill' ? fillEach : i.main)
  const usedMain = items.reduce((s, i) => s + mainExtent(i), 0) + gapsTotal

  // space-between distributes free space into the gaps; other aligns shift the block.
  let cursor = 0
  let gap = box.gap
  if (box.mainAlign === 'space-between' && n > 1) {
    const free = mainTotal - items.reduce((s, i) => s + mainExtent(i), 0)
    gap = Math.max(0, free / (n - 1))
  } else if (box.mainAlign === 'center') {
    cursor = (mainTotal - usedMain) / 2
  } else if (box.mainAlign === 'end') {
    cursor = mainTotal - usedMain
  }

  return items.map((it) => {
    const m = mainExtent(it)
    const c = it.crossMode === 'stretch' ? crossTotal : Math.min(it.cross, crossTotal)
    let crossPos = crossOrigin
    if (it.crossMode !== 'stretch') {
      if (box.crossAlign === 'center') crossPos = crossOrigin + (crossTotal - c) / 2
      else if (box.crossAlign === 'end') crossPos = crossOrigin + (crossTotal - c)
    }
    const mainPos = (horiz ? innerX : innerY) + cursor
    cursor += m + gap
    const rect: Rect = horiz
      ? { x: mainPos, y: crossPos, w: m, h: c }
      : { x: crossPos, y: mainPos, w: c, h: m }
    return { id: it.id, rect }
  })
}
