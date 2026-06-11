/** Apply an opacity to a colour for panel/scrim backgrounds. Handles #rgb,
 * #rrggbb and #rrggbbaa; anything else (named colours, rgb()) passes through
 * unchanged when opacity is full, else wraps best-effort. Shared by the
 * renderer and the editor so a scrim looks identical in both. */
export function colorToRgba(color: string, opacity = 1): string {
  const a = Math.max(0, Math.min(1, opacity))
  const hex = color.trim()
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  const m8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  let r: number, g: number, b: number, baseA = 1
  if (m3) { r = parseInt(m3[1] + m3[1], 16); g = parseInt(m3[2] + m3[2], 16); b = parseInt(m3[3] + m3[3], 16) }
  else if (m6) { r = parseInt(m6[1], 16); g = parseInt(m6[2], 16); b = parseInt(m6[3], 16) }
  else if (m8) { r = parseInt(m8[1], 16); g = parseInt(m8[2], 16); b = parseInt(m8[3], 16); baseA = parseInt(m8[4], 16) / 255 }
  else return a >= 1 ? color : color   // unparseable — leave as-is
  return `rgba(${r}, ${g}, ${b}, ${(a * baseA).toFixed(3).replace(/\.?0+$/, '')})`
}
