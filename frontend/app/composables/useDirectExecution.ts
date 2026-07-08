// Direct execution channel: talks to ComfyUI's native WS + /prompt directly,
// bypassing the hidden bridge iframe. Task 8 wires this into the same event
// handling `default.vue` already has for the bridge's postMessage events —
// `mapWsEvent` (wsEventMap.ts) produces those exact shapes so that handler
// doesn't need to change.
//
// WS TRANSPORT — same-origin /ws through the Nuxt proxy: the browser cannot
// connect straight to ComfyUI's own origin (ws://127.0.0.1:8188/ws) because
// ComfyUI's origin-check middleware (server.py, active without
// --enable-cors-header) rejects any WS handshake whose (unforgeable) Origin
// header names the Nuxt dev port instead of the loopback host → 403 → infinite
// reconnect. Instead we connect to same-origin `/ws`; the "comfy-ws-proxy"
// upgrade hook in nuxt.config.ts pipes it to 127.0.0.1:8188 while rewriting the
// Origin to the ComfyUI origin (mirroring server/middleware/comfyui-proxy.ts's
// HTTP trick), so the origin check passes. In production the same-origin /ws is
// proxied by the hosting layer to the ComfyUI backend.
//
// PARALLEL DISPATCH (Task 6) — per-worker sockets:
//   Socket state is a Map<worker, SocketState> keyed by APP-SIDE worker number
//   (0 = main on :8188, N>=1 = pool worker N routed to :8188+(N-1) via the
//   `comfyWorker=<N-1>` query param the Nuxt proxy understands). Worker 0 is
//   opened by connect()/disconnect() exactly as before; pool sockets are opened
//   lazily by queue() the first time an item routes to them, and closed again
//   the moment that worker's last in-flight prompt completes (tracked in the
//   internal promptWorker map, no registry import in the socket layer).
//   Reconnect backoff is per-socket. All sockets share ONE clientId.
//
//   queueParallel derives the usable pool size by probing pool indices 0 and 1
//   through /api/pool/ensure (a warm-up wave); the client hardcodes probing 2
//   because that matches the default pool size (server/utils/comfyWorkerPool).
//   A mismatch is harmless — extra probes that resolve non-ready are dropped,
//   fewer real workers just means some probes fail and shrink the usable set.
//
// Module-singleton: one set of sockets per app, regardless of how many
// components call useDirectExecution().

import type { ApiPrompt, LiteGraphWorkflow } from '~/lib/graph/graphToPrompt'
import { mapWsEvent, type BridgeShapedEvent } from '~/lib/graph/wsEventMap'
import { inFlight } from '~/lib/graph/runRegistry'
import { isPoolEligible } from '~/lib/graph/cloudOnly'
import { pickWorker, routeSingleRun } from '~/lib/graph/pickWorker'

export interface QueueResult {
  prompt_id?: string
  node_errors?: any
  /** Non-node error message (400 `{ error: { message } }`, network, 5xx). Set
   *  on any failure so callers can surface it instead of a silent success. */
  error?: string
  /** App-side worker this item was dispatched to (0 = main). Stamped on every
   *  result so a parallel caller can `registerRun` each prompt against the
   *  worker it actually landed on (queueParallel decides assignment internally,
   *  the sequential fallback always uses main / 0). */
  worker?: number
}

/** worker: 0/absent = main (:8188, no query param); N>=1 = pool worker N,
 *  routed to :8188+(N-1) via `?comfyWorker=${worker-1}`. */
export interface QueueOpts {
  worker?: number
}

export interface QueueParallelItem {
  prompt: ApiPrompt
  workflow: LiteGraphWorkflow
  label?: string
}

export interface DirectExecution {
  connect: () => void
  disconnect: () => void
  queue: (prompt: ApiPrompt, workflow: LiteGraphWorkflow, opts?: QueueOpts) => Promise<QueueResult>
  queueSmart: (prompt: ApiPrompt, workflow: LiteGraphWorkflow, ctx: { objectInfo: Record<string, any> }) => Promise<QueueResult>
  queueParallel: (items: QueueParallelItem[], ctx: { objectInfo: Record<string, any> }) => Promise<QueueResult[]>
  onEvent: (cb: (e: BridgeShapedEvent) => void) => void
  clientId: string
}

/** 1s → 2s → 4s → 5s (capped) reconnect backoff, indexed by consecutive-attempt count (0-based). */
export function reconnectDelayMs(attempt: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, attempt))
  return Math.min(base, 5000)
}

/** After this many CONSECUTIVE failed reconnect attempts, a POOL worker's socket
 *  is declared lost (main/worker 0 is never given up — see shouldGiveUpWorker). */
export const WORKER_LOST_MAX_FAILURES = 4

/** Pure decision: should we STOP reconnecting a socket and declare its worker
 *  lost? Main (worker 0) must retry forever, so always false for it; a pool
 *  worker (>= 1) is given up once it reaches WORKER_LOST_MAX_FAILURES consecutive
 *  failed reconnects. Exported for unit testing. */
export function shouldGiveUpWorker(worker: number, consecutiveFailures: number): boolean {
  if (worker < 1) return false
  return consecutiveFailures >= WORKER_LOST_MAX_FAILURES
}

function getClientId(): string {
  if (!import.meta.client) return ''
  let id = sessionStorage.getItem('comfynext:clientId')
  if (!id) {
    id = crypto.randomUUID()
    sessionStorage.setItem('comfynext:clientId', id)
  }
  return id
}

// Per-worker socket state — keyed by app-side worker number (0 = main).
interface SocketState {
  ws: WebSocket | null
  wantConnected: boolean
  reconnectAttempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  /** Consecutive failed reconnect attempts (reset to 0 on a successful open).
   *  Drives worker-lost detection for pool sockets — see shouldGiveUpWorker. */
  consecutiveFailures: number
}

const sockets = new Map<number, SocketState>()
let cachedClientId: string | null = null
const listeners = new Set<(e: BridgeShapedEvent) => void>()

// prompt_id → app-side worker, for pool sockets only (worker >= 1). Maintained
// by queue() at dispatch time and pruned on completion, so the socket layer can
// close a pool worker's socket once its last prompt drains — without importing
// the run registry into the hot message handler.
const promptWorker = new Map<string, number>()

// app-side worker → count of POSTs currently in flight (awaiting /prompt's
// response) for that worker. Incremented BEFORE the await in queue(), so a
// sibling item's fast execution_complete can't drain-close the socket while
// this item's prompt_id → worker mapping hasn't landed yet (the race this
// module fixes: mapping is only recorded AFTER the POST resolves). Decremented
// in queue()'s finally, regardless of success/failure. Keys are deleted at 0
// rather than left at 0 so "no entry" and "0 pending" are the same thing.
const pendingPosts = new Map<number, number>()

function reservePendingPost(worker: number): void {
  if (worker < 1) return
  pendingPosts.set(worker, (pendingPosts.get(worker) ?? 0) + 1)
}

function releasePendingPost(worker: number): void {
  if (worker < 1) return
  const next = (pendingPosts.get(worker) ?? 0) - 1
  if (next <= 0) pendingPosts.delete(worker)
  else pendingPosts.set(worker, next)
}

/** Pure decision helper for whether a pool worker's socket may be closed:
 *  only when NOTHING is keeping it busy — no mapped in-flight prompts AND no
 *  POST still awaiting its /prompt response. Worker 0 (main) is never closed
 *  here; its lifecycle belongs to connect()/disconnect(). Exported for unit
 *  testing (see direct-execution-drain.unit.spec.ts). */
export function shouldCloseWorkerSocket(
  worker: number,
  mappedWorkers: Iterable<number>,
  pendingCount: number,
): boolean {
  if (worker < 1) return false
  if (pendingCount > 0) return false
  for (const w of mappedWorkers) {
    if (w === worker) return false
  }
  return true
}

function socketFor(worker: number): SocketState {
  let s = sockets.get(worker)
  if (!s) {
    s = { ws: null, wantConnected: false, reconnectAttempt: 0, reconnectTimer: null, consecutiveFailures: 0 }
    sockets.set(worker, s)
  }
  return s
}

/** Pure URL builder — ws(s):// + origin's host/port + /ws?clientId=, plus
 *  `&comfyWorker=<0-based pool index>` for app-side workers >= 1 (worker 0 /
 *  absent = main, no param). Exported for unit testing. */
export function buildWsUrl(httpOrigin: string, clientId: string, worker = 0): string {
  const base = `${httpOrigin.replace(/^http/, 'ws')}/ws?clientId=${clientId}`
  return worker >= 1 ? `${base}&comfyWorker=${worker - 1}` : base
}

function wsUrl(clientId: string, worker: number): string {
  // Same-origin /ws — routed to ComfyUI by the nuxt.config.ts upgrade proxy
  // (which strips/rewrites the browser Origin so ComfyUI's origin check passes).
  // See the header comment above for why we never connect to :8188 directly.
  return buildWsUrl(window.location.origin, clientId, worker)
}

function scheduleReconnect(worker: number, clientId: string): void {
  const s = socketFor(worker)
  if (!s.wantConnected) return
  if (s.reconnectTimer) return
  const delay = reconnectDelayMs(s.reconnectAttempt)
  s.reconnectAttempt++
  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null
    if (s.wantConnected) openSocket(worker, clientId)
  }, delay)
}

/** Close a pool worker's (worker >= 1) socket once its last in-flight prompt has
 *  drained. Main (worker 0) is never auto-closed — its lifecycle is the flag
 *  watcher's (connect/disconnect). */
function maybeCloseDrainedPoolSocket(worker: number): void {
  if (!shouldCloseWorkerSocket(worker, promptWorker.values(), pendingPosts.get(worker) ?? 0)) return
  const s = sockets.get(worker)
  if (!s) return
  s.wantConnected = false
  if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null }
  if (s.ws) {
    const socket = s.ws
    s.ws = null
    socket.close()
  }
}

/** A POOL worker's socket has failed to reconnect too many times in a row — its
 *  ComfyUI process is gone (killed, crashed). Reconnecting forever would leave
 *  every prompt mapped to it stuck 'running' with a spinning tab. Instead:
 *  (a) synthesize an execution_error through the normal listener fan-out for EVERY
 *  prompt currently mapped to this worker (downstream toast/finishRun/drain/idle
 *  already handle execution_error), (b) drop those promptWorker + pendingPosts
 *  entries, (c) stop reconnecting this socket. Main (worker 0) is never given up. */
function giveUpWorker(worker: number, clientId: string): void {
  const s = socketFor(worker)
  s.wantConnected = false
  if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null }

  const lostPrompts: string[] = []
  for (const [pid, w] of promptWorker) {
    if (w === worker) lostPrompts.push(pid)
  }
  for (const pid of lostPrompts) {
    // Shape matches wsEventMap's execution_error variant verbatim so the same
    // downstream handler consumes it. (The brief's `traceback: null` becomes
    // `undefined` here to fit that type; node_type is included for the same
    // reason — both are informational only.)
    const err: BridgeShapedEvent = {
      event: 'execution_error',
      prompt_id: pid,
      node_id: null,
      node_type: null,
      exception_message: 'Worker connection lost',
      exception_type: 'WorkerLost',
      traceback: undefined,
    }
    for (const cb of listeners) cb(err)
    promptWorker.delete(pid)
  }
  pendingPosts.delete(worker)
  void clientId // reconnect intentionally NOT scheduled — worker is declared lost.
}

function openSocket(worker: number, clientId: string): void {
  if (!import.meta.client) return
  const s = socketFor(worker)
  if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) return

  const socket = new WebSocket(wsUrl(clientId, worker))
  s.ws = socket

  socket.addEventListener('open', () => {
    s.reconnectAttempt = 0
    s.consecutiveFailures = 0
  })

  socket.addEventListener('message', (evt) => {
    // Binary frames (live-preview images) are not JSON — ignore safely.
    if (typeof evt.data !== 'string') return
    let parsed: { type: string; data: any } | null = null
    try {
      parsed = JSON.parse(evt.data)
    } catch {
      return
    }
    const mapped = mapWsEvent(parsed, clientId)
    if (!mapped) return
    for (const cb of listeners) cb(mapped)
    // After fan-out: if this was a terminal event for a pool prompt, forget the
    // prompt→worker mapping and close the worker's socket if it just drained.
    if (mapped.event === 'execution_complete' || mapped.event === 'execution_error') {
      const pid = mapped.prompt_id
      if (pid && promptWorker.has(pid)) {
        const w = promptWorker.get(pid)!
        promptWorker.delete(pid)
        maybeCloseDrainedPoolSocket(w)
      }
    }
  })

  socket.addEventListener('close', () => {
    if (s.ws === socket) s.ws = null
    // A close while we still want the socket up is a failed connection. Count it;
    // once a POOL worker crosses the threshold, declare it lost instead of
    // retrying forever (which would strand its prompts as 'running'). Main
    // (worker 0) never gives up — shouldGiveUpWorker returns false for it.
    if (s.wantConnected) {
      s.consecutiveFailures++
      if (shouldGiveUpWorker(worker, s.consecutiveFailures)) {
        giveUpWorker(worker, clientId)
        return
      }
    }
    scheduleReconnect(worker, clientId)
  })

  socket.addEventListener('error', () => {
    // 'close' always follows 'error' for a WebSocket — reconnect scheduling
    // happens there to avoid double-scheduling.
  })
}

/** Open a pool worker's socket lazily and mark it as wanted (so reconnect works
 *  while it has prompts in flight). No-op for main / worker 0 here — main is
 *  owned by connect(). */
function ensurePoolSocket(worker: number, clientId: string): void {
  if (worker < 1 || !import.meta.client) return
  const s = socketFor(worker)
  s.wantConnected = true
  openSocket(worker, clientId)
}

export function useDirectExecution(): DirectExecution {
  if (cachedClientId === null) cachedClientId = getClientId()
  const clientId = cachedClientId

  function connect(): void {
    if (!import.meta.client) return
    const s = socketFor(0)
    s.wantConnected = true
    s.reconnectAttempt = 0
    if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null }
    openSocket(0, clientId)
  }

  function disconnect(): void {
    const s = socketFor(0)
    s.wantConnected = false
    if (s.reconnectTimer) { clearTimeout(s.reconnectTimer); s.reconnectTimer = null }
    if (s.ws) {
      const socket = s.ws
      s.ws = null
      socket.close()
    }
  }

  async function queue(
    prompt: ApiPrompt,
    workflow: LiteGraphWorkflow,
    opts?: QueueOpts,
  ): Promise<QueueResult> {
    // 1-based/0-based convention (contained ENTIRELY inside this block):
    //   opts.worker is APP-SIDE: 0/absent = main, N>=1 = pool worker N.
    //   The wire (query param + pool socket) is 0-based: pool index = worker-1.
    // Everything above/below queue() speaks app-side numbers; the only place a
    // worker number becomes 0-based is the `comfyWorker=${worker - 1}` here.
    const worker = opts?.worker ?? 0
    const path = worker >= 1 ? `/prompt?comfyWorker=${worker - 1}` : '/prompt'

    // Before POSTing to a pool worker, ensure its WS is open so we receive its
    // execution events. Main's socket is owned by connect() and left alone.
    if (worker >= 1) ensurePoolSocket(worker, clientId)

    // Reserve this worker as busy BEFORE the await: without this, a sibling
    // item on the same worker whose POST resolved first can see its
    // execution_complete, find no promptWorker entries for this worker (this
    // item's mapping only lands after ITS await resolves below), and close the
    // socket out from under this still-in-flight request.
    if (worker >= 1) reservePendingPost(worker)
    try {
      const res = await $fetch<{ prompt_id?: string }>(path, {
        method: 'POST',
        body: {
          prompt,
          client_id: clientId,
          extra_data: { extra_pnginfo: { workflow } },
        },
      })
      // Record the prompt→worker mapping for pool workers so the socket layer can
      // close the socket once this worker's prompts drain.
      if (worker >= 1 && res?.prompt_id) promptWorker.set(res.prompt_id, worker)
      return { prompt_id: res?.prompt_id, worker }
    } catch (err: any) {
      // ofetch's FetchError parses the JSON body onto `.data` on non-2xx
      // responses (see useInpaint.ts / useExplain.ts for the same convention).
      // ComfyUI's /prompt 400 body is `{ error: {...}, node_errors: {...} }`.
      // Always surface *something*: a 400 with only `{ error: { message } }`, a
      // 5xx, or a network failure must NOT resolve as a silent success (which
      // let live runs fail with zero feedback). node_errors when present drives
      // the per-node red rings; `error` is the fallback human message.
      const node_errors = err?.data?.node_errors ?? null
      const error = err?.data?.error?.message ?? err?.message ?? String(err)
      return { node_errors, error, worker }
    } finally {
      // Release the reservation whether the POST succeeded or failed. On
      // failure, no promptWorker entry was recorded for this item, so this may
      // now leave the worker fully drained (no mappings, no other pending
      // POSTs) — drain-check it here since the catch block no longer does.
      if (worker >= 1) {
        releasePendingPost(worker)
        maybeCloseDrainedPoolSocket(worker)
      }
    }
  }

  /**
   * Parallel dispatch across cloud-only pool workers.
   *
   * Sequential-on-main (preserves order, today's exact behavior) when:
   *   - there is 0 or 1 item, OR
   *   - any item is not `isPoolEligible` (mixed GPU work stays serialized), OR
   *   - no pool worker warms up ready (all-fail fallback, warned once).
   *
   * Otherwise it warms a wave of pool workers (probing pool indices 0..1 via
   * /api/pool/ensure with allSettled), keeps the ones reporting status 'ready',
   * assigns each item to the least-loaded usable worker via `pickWorker` — fed
   * from the run registry's per-worker in-flight counts PLUS this batch's own
   * pending assignments (the registry only learns about a run once queue()
   * POSTs it, so without counting our own assignments every item would pick the
   * same idle worker) — then queues them all with Promise.all. Item order is
   * preserved in the result; an individual failure returns its QueueResult
   * (error field) rather than rejecting the whole batch.
   */
  async function queueParallel(
    items: QueueParallelItem[],
    ctx: { objectInfo: Record<string, any> },
  ): Promise<QueueResult[]> {
    const runSequential = () => sequentialOnMain(items, queue)

    if (items.length <= 1) return runSequential()
    if (!items.every((it) => isPoolEligible(it.prompt, ctx.objectInfo))) return runSequential()

    // Warm-up wave: probe pool indices 0 and 1 (hardcoded 2 = default pool
    // size). Usable = those that resolve status 'ready'. App-side worker number
    // = pool index + 1.
    const PROBE_POOL_INDICES = [0, 1]
    const ensured = await Promise.allSettled(
      PROBE_POOL_INDICES.map((idx) =>
        $fetch<{ port: number; status: string }>('/api/pool/ensure', {
          method: 'POST',
          body: { worker: idx },
        }).then((r) => ({ idx, status: r?.status })),
      ),
    )

    const usableWorkers = ensured
      .filter((r): r is PromiseFulfilledResult<{ idx: number; status: string }> =>
        r.status === 'fulfilled' && r.value?.status === 'ready',
      )
      .map((r) => r.value.idx + 1) // → app-side worker number
      .sort((a, b) => a - b)

    if (usableWorkers.length === 0) {
      console.warn('[queueParallel] no pool worker ready — falling back to sequential dispatch on main')
      return runSequential()
    }

    // Cap workers to items.length (no point warming more sockets than items).
    const workerCount = Math.min(usableWorkers.length, items.length)
    const workers = usableWorkers.slice(0, workerCount)

    // pickWorker consumes a DENSE 1..poolSize load array; our usable workers may
    // be a sparse subset (e.g. only worker 2 ready). Compact them: position i in
    // the dense array (1-based) maps to workers[i-1]. Seed each with its current
    // registry in-flight count, then increment as we assign within this batch.
    const load: number[] = [0] // index 0 = main placeholder, never picked
    for (const w of workers) load.push(inFlight({ worker: w }).length)

    const assignedWorker: number[] = items.map(() => {
      const denseIdx = pickWorker(load, workers.length) // 1..workers.length
      load[denseIdx] = (load[denseIdx] ?? 0) + 1 // count our own batch assignment
      return workers[denseIdx - 1]! // dense → real app-side worker
    })

    return Promise.all(
      items.map((it, i) => queue(it.prompt, it.workflow, { worker: assignedWorker[i] })),
    )
  }

  /**
   * Single-run scheduler: prefer main while it's idle (no worker-boot
   * latency, and a lone run gains nothing from the pool), spill a
   * pool-eligible run to the least-loaded ready pool worker when main is
   * already busy — so two quick back-to-back single runs execute
   * concurrently instead of queueing on one ComfyUI instance. Any pool
   * hiccup falls back to main; the run is never blocked.
   */
  async function queueSmart(
    prompt: ApiPrompt,
    workflow: LiteGraphWorkflow,
    ctx: { objectInfo: Record<string, any> },
  ): Promise<QueueResult> {
    const mainInFlight = inFlight({ worker: 0 }).length
    const eligible = isPoolEligible(prompt, ctx.objectInfo)
    // Cheap early-out (the common case): no pool probing at all.
    if (routeSingleRun({ eligible, mainInFlight, poolInFlight: [], poolSize: 0 }) === 0
      && (mainInFlight === 0 || !eligible)) {
      return queue(prompt, workflow)
    }

    // Main is busy and the prompt is eligible — probe the pool (same warm-up
    // wave as queueParallel) and route via the pure decision.
    const PROBE_POOL_INDICES = [0, 1]
    const ensured = await Promise.allSettled(
      PROBE_POOL_INDICES.map((idx) =>
        $fetch<{ port: number; status: string }>('/api/pool/ensure', {
          method: 'POST',
          body: { worker: idx },
        }).then((r) => ({ idx, status: r?.status })),
      ),
    )
    const usable = ensured
      .filter((r): r is PromiseFulfilledResult<{ idx: number; status: string }> =>
        r.status === 'fulfilled' && r.value?.status === 'ready',
      )
      .map((r) => r.value.idx + 1)
      .sort((a, b) => a - b)
    if (usable.length === 0) {
      console.warn('[queueSmart] main busy but no pool worker ready — queueing on main')
      return queue(prompt, workflow)
    }

    // Dense compaction, same as queueParallel: position i (1-based) ↔ usable[i-1].
    const denseLoads = usable.map((w) => inFlight({ worker: w }).length)
    const dense = routeSingleRun({
      eligible,
      mainInFlight,
      poolInFlight: denseLoads,
      poolSize: usable.length,
    })
    if (dense === 0) return queue(prompt, workflow)
    return queue(prompt, workflow, { worker: usable[dense - 1]! })
  }

  function onEvent(cb: (e: BridgeShapedEvent) => void): void {
    listeners.add(cb)
  }

  return { connect, disconnect, queue, queueSmart, queueParallel, onEvent, clientId }
}

/** Sequential fallback: queue every item on main, in order, collecting each
 *  QueueResult (failures included). Shared by the several queueParallel
 *  early-outs. */
async function sequentialOnMain(
  items: QueueParallelItem[],
  queue: (p: ApiPrompt, w: LiteGraphWorkflow, opts?: QueueOpts) => Promise<QueueResult>,
): Promise<QueueResult[]> {
  const results: QueueResult[] = []
  for (const it of items) {
    results.push(await queue(it.prompt, it.workflow))
  }
  return results
}
