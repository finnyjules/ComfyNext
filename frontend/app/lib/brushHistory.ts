/**
 * Generic, immutable undo/redo snapshot stack. Pure (no Vue, no DOM) so it can
 * be unit-tested in the node-env vitest and reused by any reactive owner.
 *
 * `present` is the live value; `past`/`future` hold snapshots. Every operation
 * returns a NEW History object — callers reassign rather than mutate.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Commit a new present; the old present moves to the past and the redo future is dropped. */
export function record<T>(h: History<T>, next: T): History<T> {
  return { past: [...h.past, h.present], present: next, future: [] }
}

export function canUndo<T>(h: History<T>): boolean { return h.past.length > 0 }
export function canRedo<T>(h: History<T>): boolean { return h.future.length > 0 }

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h
  const past = h.past.slice(0, -1)
  const present = h.past[h.past.length - 1]!
  return { past, present, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h
  const [present, ...future] = h.future
  return { past: [...h.past, h.present], present: present!, future }
}
