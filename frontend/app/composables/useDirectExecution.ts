// Direct execution channel: talks to ComfyUI's native WS + /prompt directly,
// bypassing the hidden bridge iframe. Task 8 wires this into the same event
// handling `default.vue` already has for the bridge's postMessage events —
// `mapWsEvent` (wsEventMap.ts) produces those exact shapes so that handler
// doesn't need to change.
//
// WHY DIRECT-TO-COMFYUI (not same-origin /ws): in dev, Nuxt's "comfy-ws-proxy"
// hook in nuxt.config.ts is supposed to pipe same-origin /ws upgrades to
// ComfyUI on 127.0.0.1:8188, but it does NOT reliably intercept the upgrade —
// the request falls through to SSR/Vue Router ("No match found for location
// with path /ws?clientId=...") followed by an unhandled `write ECONNRESET`
// that CRASHES the Nuxt dev server. So this composable connects straight to
// the ComfyUI origin instead, the same thing the bridge iframe already does
// (see `comfyOrigin` in layouts/default.vue — the "iframe bypasses proxy"
// pattern). If/when the comfy-ws-proxy hook is made reliable for hosted
// deployments, this can revisit routing through same-origin /ws again.
//
// Module-singleton: one WS connection per app, regardless of how many
// components call useDirectExecution().

import type { ApiPrompt, LiteGraphWorkflow } from '~/lib/graph/graphToPrompt'
import { mapWsEvent, type BridgeShapedEvent } from '~/lib/graph/wsEventMap'

export interface QueueResult {
  prompt_id?: string
  node_errors?: any
}

export interface DirectExecution {
  connect: () => void
  disconnect: () => void
  queue: (prompt: ApiPrompt, workflow: LiteGraphWorkflow) => Promise<QueueResult>
  onEvent: (cb: (e: BridgeShapedEvent) => void) => void
  clientId: string
}

/** 1s → 2s → 4s → 5s (capped) reconnect backoff, indexed by consecutive-attempt count (0-based). */
export function reconnectDelayMs(attempt: number): number {
  const base = 1000 * Math.pow(2, Math.max(0, attempt))
  return Math.min(base, 5000)
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

// Module-level singleton state — shared across every useDirectExecution() call.
let ws: WebSocket | null = null
let wantConnected = false
let reconnectAttempt = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let cachedClientId: string | null = null
const listeners = new Set<(e: BridgeShapedEvent) => void>()

/** Pure URL builder — ws(s):// + origin's host/port + /ws?clientId=. Exported for unit testing. */
export function buildWsUrl(httpOrigin: string, clientId: string): string {
  return `${httpOrigin.replace(/^http/, 'ws')}/ws?clientId=${clientId}`
}

function wsUrl(clientId: string): string {
  // Same accessor the bridge iframe uses in layouts/default.vue — connect
  // straight to ComfyUI's own origin rather than same-origin /ws (see the
  // header comment above for why).
  const comfyOrigin = useRuntimeConfig().public.comfyOrigin || 'http://127.0.0.1:8188'
  return buildWsUrl(comfyOrigin, clientId)
}

function scheduleReconnect(clientId: string): void {
  if (!wantConnected) return
  if (reconnectTimer) return
  const delay = reconnectDelayMs(reconnectAttempt)
  reconnectAttempt++
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (wantConnected) openSocket(clientId)
  }, delay)
}

function openSocket(clientId: string): void {
  if (!import.meta.client) return
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const socket = new WebSocket(wsUrl(clientId))
  ws = socket

  socket.addEventListener('open', () => {
    reconnectAttempt = 0
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
    if (mapped) {
      for (const cb of listeners) cb(mapped)
    }
  })

  socket.addEventListener('close', () => {
    if (ws === socket) ws = null
    scheduleReconnect(clientId)
  })

  socket.addEventListener('error', () => {
    // 'close' always follows 'error' for a WebSocket — reconnect scheduling
    // happens there to avoid double-scheduling.
  })
}

export function useDirectExecution(): DirectExecution {
  if (cachedClientId === null) cachedClientId = getClientId()
  const clientId = cachedClientId

  function connect(): void {
    if (!import.meta.client) return
    wantConnected = true
    reconnectAttempt = 0
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    openSocket(clientId)
  }

  function disconnect(): void {
    wantConnected = false
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (ws) {
      const socket = ws
      ws = null
      socket.close()
    }
  }

  async function queue(prompt: ApiPrompt, workflow: LiteGraphWorkflow): Promise<QueueResult> {
    try {
      const res = await $fetch<{ prompt_id?: string }>('/prompt', {
        method: 'POST',
        body: {
          prompt,
          client_id: clientId,
          extra_data: { extra_pnginfo: { workflow } },
        },
      })
      return { prompt_id: res?.prompt_id }
    } catch (err: any) {
      // ofetch's FetchError parses the JSON body onto `.data` on non-2xx
      // responses (see useInpaint.ts / useExplain.ts for the same convention).
      // ComfyUI's /prompt 400 body is `{ error: {...}, node_errors: {...} }`.
      const node_errors = err?.data?.node_errors ?? null
      return { node_errors }
    }
  }

  function onEvent(cb: (e: BridgeShapedEvent) => void): void {
    listeners.add(cb)
  }

  return { connect, disconnect, queue, onEvent, clientId }
}
