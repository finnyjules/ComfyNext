// FIFO queue of pending pre-run cost confirmations.
//
// Before Task 8 this was a single ref slot (`costConfirm.value`): a second
// independent Run whose estimate also crossed the confirm threshold OVERWROTE
// the first's slot, dropping the first run's resolve — that run's confirm
// promise never settled and its dispatch hung forever (audit R3).
//
// This queue gives each Run its own request object so each resolves its OWN
// promise. The head is shown in the confirm dialog; resolving the head advances
// to the next request. Two simultaneous confirm dialogs is unusual UX, but the
// correctness requirement is that no confirm promise is ever dropped/hung.
//
// Pure, framework-free (no Vue import) so it can be unit-tested in isolation.
// The Vue layer wraps the `pending` array in a shallowRef and re-assigns it on
// mutation to drive template reactivity (see default.vue).

export interface CostConfirmRequest<E> {
  estimate: E
  iterations: number
  resolve: (ok: boolean) => void
}

export class CostConfirmQueue<E = unknown> {
  private queue: CostConfirmRequest<E>[] = []
  /** Optional hook fired after any mutation, so a Vue wrapper can re-assign a shallowRef. */
  onChange?: () => void

  constructor(onChange?: () => void) {
    this.onChange = onChange
  }

  /** The request currently shown in the dialog (FIFO head), or null when idle. */
  get head(): CostConfirmRequest<E> | null {
    return this.queue[0] ?? null
  }

  /** Live array of pending requests (head first). Do not mutate directly. */
  get pending(): ReadonlyArray<CostConfirmRequest<E>> {
    return this.queue
  }

  get size(): number {
    return this.queue.length
  }

  /**
   * Enqueue a confirm request and return a promise that settles with THIS
   * request's answer (independent of any other queued request).
   */
  enqueue(estimate: E, iterations: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.queue.push({ estimate, iterations, resolve })
      this.onChange?.()
    })
  }

  /** Resolve the head request with `ok` and advance to the next. No-op when empty. */
  resolveHead(ok: boolean): void {
    const head = this.queue.shift()
    if (!head) return
    head.resolve(ok)
    this.onChange?.()
  }

  /** Resolve every pending request `false` (e.g. teardown / navigation away). */
  cancelAll(): void {
    const drained = this.queue.splice(0, this.queue.length)
    for (const r of drained) r.resolve(false)
    this.onChange?.()
  }
}
