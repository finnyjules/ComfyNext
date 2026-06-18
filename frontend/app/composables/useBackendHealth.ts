import { ref, type Ref } from 'vue'

export interface BackendHealth {
  /** HTTP liveness (debounced). Optimistic at start. */
  backendUp: Ref<boolean>
  /** True once the backend has been reachable at least once. */
  everUp: Ref<boolean>
  start: () => void
  stop: () => void
}

export interface BackendHealthOpts {
  onRecovered?: () => void
  /**
   * Checked at a would-be recovery; if it returns true, `onRecovered` is
   * suppressed (backendUp still updates). Use this to ignore a *false* down→up
   * that a busy backend produces mid-run: a heavy generation can block the
   * event loop long enough that the probe times out, and reloading the canvas
   * on that bogus "recovery" tears down the running graph (the flicker).
   */
  suppressRecovery?: () => boolean
  healthyMs?: number      // poll interval while up (default 5000)
  downMs?: number         // poll interval while down (default 1500)
  timeoutMs?: number      // per-probe timeout (default 2000)
  failures?: number       // consecutive fails before flipping down (default 2)
  fetchFn?: typeof fetch  // injectable for tests
}

/**
 * Polls `${origin}/system_stats` to track whether the ComfyUI backend HTTP
 * server is up. Uses `no-cors` so no CORS config is needed — a resolved fetch
 * means the server responded; a rejection/timeout means it's down. Fires
 * `onRecovered` on a genuine down→up transition (after having been up at least
 * once), so the initial boot does not count as a recovery.
 */
export function useBackendHealth(origin: string, opts: BackendHealthOpts = {}): BackendHealth {
  const healthyMs = opts.healthyMs ?? 5000
  const downMs = opts.downMs ?? 1500
  const timeoutMs = opts.timeoutMs ?? 2000
  const maxFailures = opts.failures ?? 2
  // NOTE: the wrapper is intentional — calling native `fetch` unbound (`?? fetch`)
  // can throw "Illegal invocation" in browsers; wrapping preserves the correct `this`.
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  const backendUp = ref(true)   // optimistic; the debounce flips it on real failures
  const everUp = ref(false)
  let consecutiveFailures = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true

  async function probe(): Promise<boolean> {
    try {
      await doFetch(`${origin}/system_stats`, {
        mode: 'no-cors',
        signal: AbortSignal.timeout(timeoutMs),
      })
      return true
    } catch {
      return false
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const ok = await probe()
    if (stopped) return
    if (ok) {
      consecutiveFailures = 0
      const wasDown = !backendUp.value
      backendUp.value = true
      if (wasDown && everUp.value && !opts.suppressRecovery?.()) opts.onRecovered?.()
      everUp.value = true
    } else {
      consecutiveFailures++
      if (consecutiveFailures >= maxFailures) backendUp.value = false
    }
    if (stopped) return
    timer = setTimeout(tick, backendUp.value ? healthyMs : downMs)
  }

  function start(): void {
    if (!stopped) return
    stopped = false
    timer = setTimeout(tick, 0)
  }

  function stop(): void {
    stopped = true
    if (timer) { clearTimeout(timer); timer = null }
  }

  return { backendUp, everUp, start, stop }
}
