import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElection } from '~/lib/leader/election'
import type { ChannelLike, LeaderMessage, ElectionOptions } from '~/lib/leader/election'

const P1 = 'proj-1'
const P2 = 'proj-2'

// Defaults baked into the engine — mirrored here so timer math is readable.
const CLAIM_WAIT = 400
const RELEASE_WAIT = 1500
const PING_INTERVAL = 5000
const PING_TIMEOUT = 12000

/**
 * In-test stand-in for BroadcastChannel fan-out: every subscribed channel
 * receives a posted message EXCEPT the sender (real BroadcastChannel never
 * echoes) — unless the channel opted into `echo`, which we use to prove the
 * engine self-filters by windowId regardless of transport behavior.
 *
 * `pause()`/`flush()` hold deliveries so two windows can act "simultaneously"
 * (both inside their claim window before either sees the other's message).
 */
function makeBus(log: string[]) {
  type Sub = { ch: ChannelLike; echo: boolean }
  const subs: Sub[] = []
  let queue: Array<{ from: ChannelLike; msg: LeaderMessage }> | null = null

  function deliver(from: ChannelLike, msg: LeaderMessage) {
    for (const s of subs) {
      if (s.ch === from && !s.echo) continue
      s.ch.onmessage?.(msg)
    }
  }

  return {
    channel(opts: { echo?: boolean } = {}): ChannelLike {
      const ch: ChannelLike = {
        onmessage: null,
        postMessage(msg: LeaderMessage) {
          log.push(`post:${msg.windowId}:${msg.type}`)
          if (queue) queue.push({ from: ch, msg })
          else deliver(ch, msg)
        },
      }
      subs.push({ ch, echo: !!opts.echo })
      return ch
    },
    pause() { queue = [] },
    flush() {
      const q = queue ?? []
      queue = null
      for (const { from, msg } of q) deliver(from, msg)
    },
  }
}

type Bus = ReturnType<typeof makeBus>

function makeEngine(
  id: string,
  bus: Bus,
  log: string[],
  overrides: Partial<ElectionOptions> = {},
) {
  const callbacks = {
    onRoleChange: vi.fn((p: string, role: string) => log.push(`role:${id}:${p}:${role}`)),
    onFlushRequested: vi.fn(() => Promise.resolve()),
    onRemoteSaved: vi.fn(),
  }
  const channel = overrides.channel ?? bus.channel()
  const engine = createElection({ windowId: id, callbacks, ...overrides, channel })
  return { engine, callbacks, channel }
}

/** How many times `entry` appears in the log. */
const count = (log: string[], entry: string) => log.filter((l) => l === entry).length

describe('leader election engine', () => {
  let log: string[]
  let bus: Bus

  beforeEach(() => {
    vi.useFakeTimers()
    log = []
    bus = makeBus(log)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A leader of P1, B follower of P1 (B yielded to a synchronous {held}). */
  function seed() {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    A.engine.claim(P1)
    vi.advanceTimersByTime(CLAIM_WAIT)
    B.engine.claim(P1)
    return { A, B }
  }

  it('solo claim: claiming, then leader after claimWaitMs', () => {
    const A = makeEngine('A', bus, log)
    A.engine.claim(P1)
    expect(A.engine.roleOf(P1)).toBe('claiming')
    vi.advanceTimersByTime(CLAIM_WAIT - 1)
    expect(A.engine.roleOf(P1)).toBe('claiming')
    vi.advanceTimersByTime(1)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(A.callbacks.onRoleChange.mock.calls).toEqual([
      [P1, 'claiming'],
      [P1, 'leader'],
    ])
  })

  it('second claim: leader replies {held}, claimant becomes follower', () => {
    const { A, B } = seed()
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')
    expect(count(log, 'post:A:held')).toBe(1)
    // B never got promoted, even after its claim window would have elapsed.
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(B.engine.roleOf(P1)).toBe('follower')
  })

  it('simultaneous claims: earlier ts wins (A first)', () => {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    bus.pause()
    A.engine.claim(P1)
    vi.advanceTimersByTime(10)
    B.engine.claim(P1)
    bus.flush()
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')
  })

  it('simultaneous claims: earlier ts wins even for the larger windowId (B first)', () => {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    bus.pause()
    B.engine.claim(P1)
    vi.advanceTimersByTime(10)
    A.engine.claim(P1)
    bus.flush()
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(B.engine.roleOf(P1)).toBe('leader')
    expect(A.engine.roleOf(P1)).toBe('follower')
  })

  it('simultaneous claims at equal ts: smaller windowId wins', () => {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    bus.pause()
    A.engine.claim(P1)
    B.engine.claim(P1) // same fake-timer instant → equal ts
    bus.flush()
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')
  })

  it('simultaneous claims at equal ts: smaller windowId wins regardless of claim order', () => {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    bus.pause()
    B.engine.claim(P1) // B acts first, but A has the smaller windowId
    A.engine.claim(P1)
    bus.flush()
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')
  })

  it('late overlapping claim: the earlier claimant re-announces and the late one yields', () => {
    // B claims after A's claim was already delivered (B was not yet
    // participating, so it dropped A's message). A, still claiming with the
    // earlier order, re-broadcasts its claim so B can learn it lost.
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    A.engine.claim(P1)
    vi.advanceTimersByTime(100)
    B.engine.claim(P1)
    expect(B.engine.roleOf(P1)).toBe('follower')
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')
  })

  it('self-filtering: an echoing channel does not confuse the engine', () => {
    const A = makeEngine('A', bus, log, { channel: bus.channel({ echo: true }) })
    A.engine.claim(P1)
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    // Own 'saved' echoes back — must not trigger onRemoteSaved on self.
    A.engine.notifySaved(P1, 777)
    expect(A.callbacks.onRemoteSaved).not.toHaveBeenCalled()
  })

  it('leader pings keep a follower from re-claiming', () => {
    const { A, B } = seed()
    vi.advanceTimersByTime(PING_INTERVAL * 3)
    expect(count(log, 'post:A:ping')).toBeGreaterThanOrEqual(3)
    expect(B.engine.roleOf(P1)).toBe('follower')
    expect(count(log, 'post:B:claim')).toBe(1) // only the original claim
  })

  it('follower re-claims via the claim protocol after the leader goes silent', () => {
    const { A, B } = seed()
    A.engine.destroy()
    vi.advanceTimersByTime(PING_TIMEOUT)
    expect(B.engine.roleOf(P1)).toBe('claiming') // full protocol, not instant leader
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(B.engine.roleOf(P1)).toBe('leader')
  })

  it('takeover happy path: flush resolves → released posted → requester promotes, in that order', async () => {
    const { A, B } = seed()
    let resolveFlush!: () => void
    A.callbacks.onFlushRequested.mockImplementation(
      () => new Promise<void>((res) => { resolveFlush = () => { log.push('flush-resolved'); res() } }),
    )

    B.engine.takeover(P1)
    expect(A.callbacks.onFlushRequested).toHaveBeenCalledWith(P1)
    // Nothing released while the flush is still in flight.
    expect(count(log, 'post:A:released')).toBe(0)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(B.engine.roleOf(P1)).toBe('follower')

    resolveFlush()
    await vi.advanceTimersByTimeAsync(0)

    expect(A.engine.roleOf(P1)).toBe('follower')
    expect(B.engine.roleOf(P1)).toBe('leader')
    const i = (entry: string) => log.indexOf(entry)
    expect(i('flush-resolved')).toBeGreaterThanOrEqual(0)
    expect(i('flush-resolved')).toBeLessThan(i('post:A:released'))
    expect(i('post:A:released')).toBeLessThan(i(`role:B:${P1}:leader`))
  })

  it('takeover with a dead leader: promotes after releaseWaitMs without a {released}', () => {
    const B = makeEngine('B', bus, log)
    B.engine.takeover(P1)
    expect(B.engine.roleOf(P1)).not.toBe('leader')
    vi.advanceTimersByTime(RELEASE_WAIT - 1)
    expect(B.engine.roleOf(P1)).not.toBe('leader')
    vi.advanceTimersByTime(1)
    expect(B.engine.roleOf(P1)).toBe('leader')
  })

  it('hung flush: leader releases anyway after releaseWaitMs', () => {
    // B gets a much longer releaseWait so the promotion we observe at 1500ms
    // can only come from A's cap posting {released}, not B's own timeout.
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log, { releaseWaitMs: 60000 })
    A.engine.claim(P1)
    vi.advanceTimersByTime(CLAIM_WAIT)
    B.engine.claim(P1)

    A.callbacks.onFlushRequested.mockImplementation(() => new Promise<void>(() => {})) // never resolves
    B.engine.takeover(P1)
    vi.advanceTimersByTime(RELEASE_WAIT)

    expect(count(log, 'post:A:released')).toBe(1)
    expect(A.engine.roleOf(P1)).toBe('follower')
    expect(B.engine.roleOf(P1)).toBe('leader')
  })

  it('rejecting flush still releases', async () => {
    const { A, B } = seed()
    A.callbacks.onFlushRequested.mockImplementation(() => Promise.reject(new Error('save failed')))
    B.engine.takeover(P1)
    await vi.advanceTimersByTimeAsync(0)
    expect(count(log, 'post:A:released')).toBe(1)
    expect(A.engine.roleOf(P1)).toBe('follower')
    expect(B.engine.roleOf(P1)).toBe('leader')
  })

  it('released while a plain follower (no takeover initiated): no instant promote, ping timeout handles it', () => {
    const { A, B } = seed()
    A.engine.release(P1)
    expect(count(log, 'post:A:released')).toBe(1)
    expect(B.engine.roleOf(P1)).toBe('follower') // vacancy is NOT auto-claimed
    vi.advanceTimersByTime(PING_TIMEOUT)
    expect(B.engine.roleOf(P1)).toBe('claiming')
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(B.engine.roleOf(P1)).toBe('leader')
  })

  it('saved: follower gets onRemoteSaved, leader ignores incoming saved, sender does not self-notify', () => {
    const { A, B } = seed()
    A.engine.notifySaved(P1, 123)
    expect(B.callbacks.onRemoteSaved).toHaveBeenCalledExactlyOnceWith(P1, 123)
    expect(A.callbacks.onRemoteSaved).not.toHaveBeenCalled()

    // A is leader: a stray {saved} from elsewhere is a split-brain hint — ignored.
    const z = bus.channel()
    z.postMessage({ type: 'saved', projectUuid: P1, windowId: 'Z', ts: Date.now(), savedAt: 9 })
    expect(A.callbacks.onRemoteSaved).not.toHaveBeenCalled()
  })

  it('notifySaved is a no-op unless leader', () => {
    const { A, B } = seed()
    B.engine.notifySaved(P1, 42)
    expect(count(log, 'post:B:saved')).toBe(0)
    expect(A.callbacks.onRemoteSaved).not.toHaveBeenCalled()
    // Untracked project: also a no-op.
    A.engine.notifySaved(P2, 42)
    expect(count(log, 'post:A:saved')).toBe(0)
  })

  it('release: broadcasts released when leader, stops pings, roleOf goes null', () => {
    const { A } = seed()
    A.engine.release(P1)
    expect(count(log, 'post:A:released')).toBe(1)
    expect(A.engine.roleOf(P1)).toBeNull()
    const pingsAtRelease = count(log, 'post:A:ping')
    vi.advanceTimersByTime(PING_INTERVAL * 3)
    expect(count(log, 'post:A:ping')).toBe(pingsAtRelease)
  })

  it('release as follower does not broadcast released', () => {
    const { B } = seed()
    B.engine.release(P1)
    expect(count(log, 'post:B:released')).toBe(0)
    expect(B.engine.roleOf(P1)).toBeNull()
  })

  it('releaseAll releases every tracked project', () => {
    const A = makeEngine('A', bus, log)
    A.engine.claim(P1)
    A.engine.claim(P2)
    vi.advanceTimersByTime(CLAIM_WAIT)
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(A.engine.roleOf(P2)).toBe('leader')
    A.engine.releaseAll()
    expect(count(log, 'post:A:released')).toBe(2)
    expect(A.engine.roleOf(P1)).toBeNull()
    expect(A.engine.roleOf(P2)).toBeNull()
  })

  it('destroy clears timers and detaches onmessage', () => {
    const { A } = seed()
    const pings = count(log, 'post:A:ping')
    A.engine.destroy()
    expect(A.channel.onmessage).toBeNull()
    vi.advanceTimersByTime(PING_INTERVAL * 4)
    expect(count(log, 'post:A:ping')).toBe(pings)
  })

  it('tracks multiple projects independently', () => {
    const A = makeEngine('A', bus, log)
    const B = makeEngine('B', bus, log)
    A.engine.claim(P1)
    vi.advanceTimersByTime(CLAIM_WAIT)
    B.engine.claim(P2)
    vi.advanceTimersByTime(CLAIM_WAIT)
    B.engine.claim(P1) // held by A → follower
    expect(A.engine.roleOf(P1)).toBe('leader')
    expect(A.engine.roleOf(P2)).toBeNull() // A never joined P2
    expect(B.engine.roleOf(P1)).toBe('follower')
    expect(B.engine.roleOf(P2)).toBe('leader')
    A.engine.release(P1)
    expect(A.engine.roleOf(P1)).toBeNull()
    expect(B.engine.roleOf(P2)).toBe('leader') // untouched
  })

  it('no duplicate onRoleChange for an unchanged role', () => {
    const B = makeEngine('B', bus, log)
    B.engine.claim(P1)
    const z = bus.channel()
    const held: LeaderMessage = { type: 'held', projectUuid: P1, windowId: 'Z', ts: Date.now() }
    z.postMessage(held)
    z.postMessage(held) // second held → still follower, no repeat callback
    expect(B.callbacks.onRoleChange.mock.calls).toEqual([
      [P1, 'claiming'],
      [P1, 'follower'],
    ])
  })
})
