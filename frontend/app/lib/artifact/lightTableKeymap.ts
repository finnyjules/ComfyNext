/** Pure keyboard map for the Light Table (spec §Light Table · Keyboard). */
export type LtAction =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'setActive' }
  | { type: 'pin' }
  | { type: 'discard' }
  | { type: 'promote' }
  | { type: 'lightbox' }
  | { type: 'close' }

export function keyToLightTableAction(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
): LtAction | null {
  const mod = !!e.metaKey || !!e.ctrlKey
  switch (e.key) {
    case 'ArrowLeft': return { type: 'move', dx: -1, dy: 0 }
    case 'ArrowRight': return { type: 'move', dx: 1, dy: 0 }
    case 'ArrowUp': return { type: 'move', dx: 0, dy: -1 }
    case 'ArrowDown': return { type: 'move', dx: 0, dy: 1 }
    case 'Enter': return mod ? { type: 'promote' } : { type: 'setActive' }
    case 'p': case 'P': return { type: 'pin' }
    case 'x': case 'X': return { type: 'discard' }
    case ' ': return { type: 'lightbox' }
    case 'Escape': return { type: 'close' }
    default: return null
  }
}
