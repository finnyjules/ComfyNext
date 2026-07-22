/**
 * useProjectLeadership — thin Vue wrapper around the transport-agnostic
 * leader-election engine (`~/lib/leader/election`).
 *
 * Exactly ONE window may edit/save a given project at a time; other windows
 * are read-only mirrors with an explicit takeover action. Windows coordinate
 * over a BroadcastChannel ('sailor:project-leader').
 *
 * Module-level singleton: every caller shares one engine and one reactive
 * `roles` map, so leadership is consistent across components. On the server,
 * or in browsers without BroadcastChannel, this degrades to a stub where
 * `isLeader()` is always true and every method no-ops — i.e. the app behaves
 * exactly as it does today.
 */
import { reactive, getCurrentScope, onScopeDispose } from 'vue'
import { createElection } from '~/lib/leader/election'
import type { ChannelLike, LeaderMessage, LeaderRole } from '~/lib/leader/election'

const CHANNEL_NAME = 'sailor:project-leader'

type Engine = ReturnType<typeof createElection>

const roles = reactive<Record<string, LeaderRole>>({})

let engine: Engine | null = null
let nativeChannel: BroadcastChannel | null = null
let flushCb: ((projectUuid: string) => Promise<void>) | null = null
let savedCb: ((projectUuid: string, savedAt: number | undefined) => void) | null = null
let onPageHide: (() => void) | null = null
let refCount = 0

function ensureEngine(): Engine | null {
  if (engine) return engine
  if (import.meta.server || typeof BroadcastChannel === 'undefined') return null

  const ch = new BroadcastChannel(CHANNEL_NAME)
  const adapted: ChannelLike = {
    postMessage: ch.postMessage.bind(ch),
    onmessage: null,
  }
  ch.onmessage = (e: MessageEvent) => adapted.onmessage?.(e.data as LeaderMessage)
  nativeChannel = ch

  engine = createElection({
    windowId: crypto.randomUUID(),
    channel: adapted,
    callbacks: {
      onRoleChange(projectUuid, role) {
        roles[projectUuid] = role
      },
      onFlushRequested(projectUuid) {
        return flushCb ? flushCb(projectUuid) : Promise.resolve()
      },
      onRemoteSaved(projectUuid, savedAt) {
        savedCb?.(projectUuid, savedAt)
      },
    },
  })

  onPageHide = () => engine?.releaseAll()
  window.addEventListener('pagehide', onPageHide)
  return engine
}

function teardown() {
  engine?.releaseAll()
  engine?.destroy()
  engine = null
  nativeChannel?.close()
  nativeChannel = null
  if (onPageHide) {
    window.removeEventListener('pagehide', onPageHide)
    onPageHide = null
  }
  for (const k of Object.keys(roles)) delete roles[k]
}

export function useProjectLeadership() {
  ensureEngine()
  refCount++
  if (getCurrentScope()) {
    onScopeDispose(() => {
      refCount--
      if (refCount <= 0) teardown()
    })
  }

  /** True when this window may edit/save the project. Untracked uuids (tabs
   *  without a real project, projects this window never claimed) stay
   *  editable — the current single-window behavior. */
  function isLeader(projectUuid?: string | null): boolean {
    if (!projectUuid) return true
    const role = roles[projectUuid]
    return role === undefined || role === 'leader'
  }

  return {
    roles,
    isLeader,
    roleOf(projectUuid: string): LeaderRole | null {
      return engine ? engine.roleOf(projectUuid) : 'leader'
    },
    claim(projectUuid: string) {
      ensureEngine()?.claim(projectUuid)
    },
    takeover(projectUuid: string) {
      ensureEngine()?.takeover(projectUuid)
    },
    release(projectUuid: string) {
      engine?.release(projectUuid)
      delete roles[projectUuid]
    },
    releaseAll() {
      engine?.releaseAll()
      for (const k of Object.keys(roles)) delete roles[k]
    },
    notifySaved(projectUuid: string, savedAt?: number) {
      engine?.notifySaved(projectUuid, savedAt)
    },
    /** Register the app's save-flush hook (latest registration wins). */
    onFlushRequested(cb: (projectUuid: string) => Promise<void>) {
      flushCb = cb
    },
    /** Register the follower auto-refresh hook (latest registration wins). */
    onRemoteSaved(cb: (projectUuid: string, savedAt: number | undefined) => void) {
      savedCb = cb
    },
  }
}
