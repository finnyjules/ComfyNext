/**
 * Per-project leader election over a BroadcastChannel-like transport.
 *
 * The app autosaves project docs, and multiple windows of the same origin can
 * hold copies of the same project. This engine elects exactly ONE window (the
 * "leader") allowed to edit/save a given project; other windows are read-only
 * "followers" with an explicit takeover action. A server-side 409 freshness
 * guard remains the backstop — this is the cooperative first line of defense.
 *
 * Transport-agnostic and fully injectable (clock + timers) for tests: no Vue,
 * no browser globals. The thin Vue wrapper lives in
 * `app/composables/useProjectLeadership.ts`.
 *
 * Protocol sketch (per projectUuid):
 * - claim: broadcast {claim}; wait claimWaitMs. A {held} reply (from the
 *   current leader) or an earlier-ordered rival {claim} demotes to follower;
 *   otherwise promote to leader. Ordering: smaller ts wins, tie broken by
 *   smaller windowId. A claimant that receives a LATER-ordered rival claim
 *   re-broadcasts its own claim (original ts) so a late-starting rival — who
 *   missed the first broadcast because it wasn't participating yet — learns
 *   it lost.
 * - leader: replies {held} to claims, broadcasts {ping} every pingIntervalMs,
 *   and on an incoming {takeover} awaits onFlushRequested (capped at
 *   releaseWaitMs so a hung flush can't wedge the protocol), then posts
 *   {released} and demotes.
 * - follower: promotes via {released} only for a takeover it initiated;
 *   otherwise silence from the leader for pingTimeoutMs triggers a fresh
 *   claim (full protocol, not instant promotion).
 */

export type LeaderRole = 'leader' | 'follower' | 'claiming'

export interface LeaderMessage {
  type: 'claim' | 'held' | 'takeover' | 'released' | 'saved' | 'ping'
  projectUuid: string
  windowId: string
  ts: number // sender clock ms
  savedAt?: number // for 'saved'
}

export interface ChannelLike {
  postMessage(msg: LeaderMessage): void
  onmessage: ((msg: LeaderMessage) => void) | null // engine assigns this
}

export interface ElectionCallbacks {
  onRoleChange(projectUuid: string, role: LeaderRole): void
  /** Called on the CURRENT leader when another window requests takeover.
   *  Engine awaits the returned promise (the app flushes its save inside),
   *  THEN posts 'released' and demotes to follower. */
  onFlushRequested(projectUuid: string): Promise<void>
  /** A remote leader durably saved this project (for follower auto-refresh). */
  onRemoteSaved(projectUuid: string, savedAt: number | undefined): void
}

export interface ElectionOptions {
  windowId: string
  channel: ChannelLike
  callbacks: ElectionCallbacks
  now?: () => number // default Date.now
  setTimer?: (fn: () => void, ms: number) => any // default setTimeout
  clearTimer?: (h: any) => void // default clearTimeout
  claimWaitMs?: number // default 400
  releaseWaitMs?: number // default 1500
  pingIntervalMs?: number // default 5000
  pingTimeoutMs?: number // default 12000
}

interface ProjectState {
  role: LeaderRole
  /** ts of my in-flight claim; the tiebreak key while 'claiming'. */
  claimTs: number
  /** Set while I have a {takeover} in flight and await {released}. */
  takeoverPending: boolean
  /** Set while I (as leader) am flushing in response to a {takeover}. */
  releasing: boolean
  claimTimer?: any
  pingTimer?: any
  pingTimeoutTimer?: any
  takeoverTimer?: any
  releaseCapTimer?: any
}

const TIMER_KEYS = [
  'claimTimer',
  'pingTimer',
  'pingTimeoutTimer',
  'takeoverTimer',
  'releaseCapTimer',
] as const

export function createElection(opts: ElectionOptions) {
  const {
    windowId,
    channel,
    callbacks,
    now = Date.now,
    setTimer = (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer = (h: any) => clearTimeout(h),
    claimWaitMs = 400,
    releaseWaitMs = 1500,
    pingIntervalMs = 5000,
    pingTimeoutMs = 12000,
  } = opts

  const states = new Map<string, ProjectState>()

  function freshState(): ProjectState {
    return { role: 'follower', claimTs: 0, takeoverPending: false, releasing: false }
  }

  function post(type: LeaderMessage['type'], projectUuid: string, extra?: Partial<LeaderMessage>) {
    channel.postMessage({ type, projectUuid, windowId, ts: now(), ...extra })
  }

  function setRole(p: string, st: ProjectState, role: LeaderRole) {
    if (st.role === role) return
    st.role = role
    callbacks.onRoleChange(p, role)
  }

  function clearAllTimers(st: ProjectState) {
    for (const k of TIMER_KEYS) {
      if (st[k] != null) {
        clearTimer(st[k])
        st[k] = undefined
      }
    }
  }

  /** Still the live state object for p? Guards stale timer callbacks. */
  function isLive(p: string, st: ProjectState) {
    return states.get(p) === st
  }

  function becomeLeader(p: string, st: ProjectState) {
    clearAllTimers(st)
    st.takeoverPending = false
    st.releasing = false
    schedulePing(p, st)
    setRole(p, st, 'leader')
  }

  function schedulePing(p: string, st: ProjectState) {
    st.pingTimer = setTimer(() => {
      if (!isLive(p, st) || st.role !== 'leader') return
      post('ping', p)
      schedulePing(p, st)
    }, pingIntervalMs)
  }

  function becomeFollower(p: string, st: ProjectState) {
    clearAllTimers(st)
    st.releasing = false
    armPingTimeout(p, st)
    setRole(p, st, 'follower')
  }

  /** (Re)start the follower's dead-leader watchdog. */
  function armPingTimeout(p: string, st: ProjectState) {
    if (st.pingTimeoutTimer != null) clearTimer(st.pingTimeoutTimer)
    st.pingTimeoutTimer = setTimer(() => {
      if (!isLive(p, st) || st.role !== 'follower') return
      claim(p)
    }, pingTimeoutMs)
  }

  /** Evidence a leader is alive — resets the watchdog while following. */
  function leaderActivity(p: string, st: ProjectState) {
    if (st.role === 'follower') armPingTimeout(p, st)
  }

  function claim(p: string) {
    let st = states.get(p)
    if (!st) {
      st = freshState()
      states.set(p, st)
    }
    clearAllTimers(st)
    st.takeoverPending = false
    st.claimTs = now()
    setRole(p, st, 'claiming')
    post('claim', p, { ts: st.claimTs })
    st.claimTimer = setTimer(() => {
      if (!isLive(p, st) || st.role !== 'claiming') return
      becomeLeader(p, st)
    }, claimWaitMs)
  }

  function takeover(p: string) {
    let st = states.get(p)
    if (!st) {
      st = freshState()
      states.set(p, st)
      callbacks.onRoleChange(p, 'follower')
      armPingTimeout(p, st)
    }
    if (st.role === 'leader') return
    st.takeoverPending = true
    post('takeover', p)
    if (st.takeoverTimer != null) clearTimer(st.takeoverTimer)
    st.takeoverTimer = setTimer(() => {
      // Dead leader: no {released} arrived — proceed to leader anyway.
      if (!isLive(p, st) || !st.takeoverPending) return
      becomeLeader(p, st)
    }, releaseWaitMs)
  }

  /** I am the leader of p and another window asked to take over. */
  function handleTakeoverRequest(p: string, st: ProjectState) {
    if (st.releasing) return // a flush is already in flight for this project
    st.releasing = true
    const finish = () => {
      if (!isLive(p, st) || st.role !== 'leader' || !st.releasing) return
      post('released', p)
      becomeFollower(p, st)
    }
    // A hung flush must not wedge the protocol: cap the wait, then release.
    st.releaseCapTimer = setTimer(finish, releaseWaitMs)
    let flushed: Promise<void>
    try {
      flushed = Promise.resolve(callbacks.onFlushRequested(p))
    } catch {
      flushed = Promise.resolve() // a throwing flush is treated like a rejection
    }
    flushed.then(finish, finish)
  }

  channel.onmessage = (msg: LeaderMessage) => {
    if (!msg || msg.windowId === windowId) return // never trust the transport not to echo
    const p = msg.projectUuid
    const st = states.get(p)
    if (!st) return // not participating in this project
    switch (msg.type) {
      case 'claim':
        if (st.role === 'leader') {
          post('held', p)
        } else if (st.role === 'claiming') {
          const theirsFirst =
            msg.ts < st.claimTs || (msg.ts === st.claimTs && msg.windowId < windowId)
          if (theirsFirst) becomeFollower(p, st)
          // I win: re-announce with my ORIGINAL ts so a late claimant that
          // missed my first broadcast learns the ordering and yields.
          else post('claim', p, { ts: st.claimTs })
        }
        break
      case 'held':
        if (st.role === 'claiming') becomeFollower(p, st)
        else leaderActivity(p, st)
        break
      case 'ping':
        leaderActivity(p, st)
        break
      case 'saved':
        if (st.role === 'follower') {
          leaderActivity(p, st)
          callbacks.onRemoteSaved(p, msg.savedAt)
        }
        // As leader: a remote 'saved' is a split-brain hint — ignore it.
        break
      case 'takeover':
        if (st.role === 'leader') handleTakeoverRequest(p, st)
        break
      case 'released':
        if (st.takeoverPending) {
          // The takeover I initiated: old leader has flushed and yielded —
          // promote immediately, no claim wait.
          becomeLeader(p, st)
        }
        // Plain follower: leadership is vacant, but we do NOT auto-claim; the
        // armed ping-timeout watchdog promotes in due time if no one steps up.
        break
    }
  }

  function release(p: string) {
    const st = states.get(p)
    if (!st) return
    if (st.role === 'leader') post('released', p)
    clearAllTimers(st)
    states.delete(p)
  }

  return {
    claim,
    takeover,
    release,
    releaseAll() {
      for (const p of [...states.keys()]) release(p)
    },
    notifySaved(projectUuid: string, savedAt?: number) {
      // Followers must never emit 'saved'.
      if (states.get(projectUuid)?.role !== 'leader') return
      post('saved', projectUuid, { savedAt })
    },
    roleOf(projectUuid: string): LeaderRole | null {
      return states.get(projectUuid)?.role ?? null
    },
    destroy() {
      for (const st of states.values()) clearAllTimers(st)
      states.clear()
      channel.onmessage = null
    },
  }
}
