// What the capsule's one button says, and what it does — declared together.
//
// They were declared apart, and drifted immediately: the running capsule read
// "Stop" but called the run dispatcher (whose first line returns early while
// `running`, so the button was simply inert), and the failed capsule read
// "Show the error" but re-ran the node. One table, one source, so a label can
// no longer promise something the handler does not do.

export type CapsuleState = 'ready' | 'running' | 'done' | 'failed'

/** What the button asks the host component to do. */
export type CapsuleAction =
  /** Run this node, upstream cached. */
  | 'run'
  /** Interrupt the in-flight execution. */
  | 'stop'
  /** Open the full card — the read-out truncates, the card's error chip
   *  doesn't. */
  | 'expand'

export const CAPSULE_ACTIONS: Record<CapsuleState, { label: string; action: CapsuleAction }> = {
  ready: { label: 'Run', action: 'run' },
  running: { label: 'Stop', action: 'stop' },
  done: { label: 'Run again', action: 'run' },
  // An alert glyph that silently fired a fresh run was the worst of both: you
  // pressed "show me what went wrong" and paid for another generation. The
  // read-out already truncates the message at 60 chars, so opening the card —
  // where the full error chip lives — is what the label actually promises.
  failed: { label: 'Show the error', action: 'expand' },
}

export function capsuleAction(state: CapsuleState): CapsuleAction {
  return CAPSULE_ACTIONS[state].action
}

export function capsuleActionLabel(state: CapsuleState): string {
  return CAPSULE_ACTIONS[state].label
}
