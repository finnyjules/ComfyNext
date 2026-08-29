/**
 * Shared review-strip layout classes — the tray + bar, one source of truth so
 * the studio take strip and the canvas sketch strip stay identical. The tile
 * chrome (size, clip, selection ring, action-reveal overlay) lives in
 * ReviewTile.vue; these are only the strip-level containers around it.
 */
// In-studio-modal tray: subtle translucent panel under the preview.
export const TRAY_PANEL = 'flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] p-2'
// Over-canvas tray: solid dark floating card with lift + blur.
export const TRAY_FLOATING = 'flex flex-col gap-2 rounded-[9px] border border-white/10 bg-[#0b0d11]/95 p-2 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur'
// The row of tiles.
export const TILES_ROW = 'flex items-stretch gap-[5px]'
// The actions bar under the tiles.
export const ACTIONS_BAR = 'flex items-center gap-2'
