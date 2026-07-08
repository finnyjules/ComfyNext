// Maps ComfyUI WebSocket messages ({ type, data }) to the bridge-shaped event
// objects `default.vue`'s `handleBridgeEvent`-style switch already consumes
// (see custom_nodes/comfynext_bridge/js/bridge.js, api.addEventListener
// blocks around lines 1316-1383). Task 8 will pipe useDirectExecution's
// events straight into that same handler, so field names here must match the
// bridge verbatim — NOT the Task 7 brief where the two disagree.
//
// Pure function: no I/O, no state. Unknown/ignored types return null so the
// caller can simply skip dispatch.

export type BridgeShapedEvent =
  | { event: 'execution_start'; prompt_id: string | null }
  | { event: 'progress'; percent: number; prompt_id: string | null; node_id: string | null }
  | { event: 'executing'; node_id: string; display_node: string | undefined; prompt_id: string | null }
  | { event: 'execution_complete'; prompt_id: string | null }
  | { event: 'executed'; node_id: string; output: any; prompt_id: string | null }
  | {
      event: 'execution_error'
      node_id: string | null
      node_type: string | null
      exception_message: string | null
      exception_type: string | null
      traceback: string | undefined
    ; prompt_id: string | null
    }
  | { event: 'gate_paused'; node_id: string | undefined; prompt_id: string | undefined }

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** True if `data` carries a client identifier that names a *different* client. */
function isForeignClient(data: Record<string, any>, myClientId: string): boolean {
  const carried = data.clientId ?? data.client_id ?? data.sid
  return typeof carried === 'string' && carried !== myClientId
}

export function mapWsEvent(msg: { type: string; data: any } | null | undefined, myClientId: string): BridgeShapedEvent | null {
  if (!msg || typeof msg.type !== 'string') return null
  const data = msg.data
  if (!isPlainObject(data)) return null
  if (isForeignClient(data, myClientId)) return null

  switch (msg.type) {
    case 'execution_start':
      return { event: 'execution_start', prompt_id: data.prompt_id ?? null }

    case 'progress': {
      const { value, max, prompt_id, node } = data
      const percent = Math.round((value / max) * 100)
      return { event: 'progress', percent, prompt_id: prompt_id ?? null, node_id: node ?? null }
    }

    case 'executing':
      if (data.node === null || data.node === undefined) {
        return { event: 'execution_complete', prompt_id: data.prompt_id ?? null }
      }
      return {
        event: 'executing',
        node_id: data.node,
        display_node: data.display_node,
        prompt_id: data.prompt_id ?? null,
      }

    case 'executed':
      return {
        event: 'executed',
        node_id: data.node,
        output: data.output,
        prompt_id: data.prompt_id ?? null,
      }

    case 'execution_error':
      return {
        event: 'execution_error',
        node_id: data.node_id ?? data.node ?? null,
        node_type: data.node_type ?? null,
        exception_message: data.exception_message ?? data.message ?? null,
        exception_type: data.exception_type ?? null,
        traceback: Array.isArray(data.traceback) ? data.traceback.join('') : data.traceback,
        prompt_id: data.prompt_id ?? null,
      }

    // Modern ComfyUI emits execution_success; older/alt builds may emit
    // execution_complete directly. Both map to the bridge's completion shape.
    case 'execution_success':
    case 'execution_complete':
      return { event: 'execution_complete', prompt_id: data.prompt_id ?? null }

    case 'gate_paused':
      return { event: 'gate_paused', node_id: data.node_id, prompt_id: data.prompt_id }

    // Queue-length/exec-info heartbeat — not consumed by the bridge's event
    // switch today. Ignored in v1 per brief.
    case 'status':
      return null

    default:
      return null
  }
}
