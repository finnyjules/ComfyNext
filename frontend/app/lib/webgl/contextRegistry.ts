// A registry of every live WebGL context the app holds. Browsers cap the number
// of simultaneous WebGL contexts (~16 in Chrome) and, when that cap is exceeded,
// SILENTLY kill the OLDEST context to make room — which reads to the user as a
// studio or node "crashing" (a permanently blank canvas, no error). Sailor is a
// node canvas where many things each own a context (every studio, every 3D/Space
// Type/Shape node with a live preview, every GLB viewer), so staying under the cap
// matters. Each of those registers here on construction and releases on dispose,
// which (a) powers a dev-time counter so you can see how close you are to the cap,
// and (b) makes every context source auditable in one place.

export interface WebGLContextHandle {
  /** Idempotent — safe to call from a dispose() that may run more than once. */
  release(): void
}

interface Entry { label: string }

const entries = new Map<number, Entry>()
let seq = 0

/** Chrome's practical simultaneous-context ceiling. Advisory only — nothing here
 *  enforces it; it's the threshold the dev counter warns at. */
export const WEBGL_CONTEXT_SOFT_CAP = 16

type Listener = (count: number) => void
const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) l(entries.size)
}

/** Register a live context. Call once per real WebGLRenderer/context, keep the
 *  handle, and call `handle.release()` in the owner's dispose(). */
export function registerWebGLContext(label: string): WebGLContextHandle {
  const id = ++seq
  entries.set(id, { label })
  notify()
  return {
    release() { if (entries.delete(id)) notify() },
  }
}

export function liveWebGLContextCount(): number {
  return entries.size
}

/** Labels of every currently-live context, for the dev overlay / console. */
export function liveWebGLContextLabels(): string[] {
  return [...entries.values()].map((e) => e.label)
}

/** Subscribe to count changes (dev overlay). Returns an unsubscribe fn. */
export function onWebGLContextChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Always-available console probe (harmless in prod, invaluable when diagnosing a
// context-loss report): `__sailorWebGL()` → { count, cap, labels }.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __sailorWebGL?: () => unknown }).__sailorWebGL = () => ({
    count: liveWebGLContextCount(),
    cap: WEBGL_CONTEXT_SOFT_CAP,
    labels: liveWebGLContextLabels(),
  })
}
