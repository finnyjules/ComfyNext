/** Tiny fixed-window per-key rate limiter. In-memory on purpose: this is a
 *  single-process local app today; it exists to stop runaway client loops from
 *  burning the user's Anthropic credits, not to survive a distributed attack.
 *  The hosted-SaaS ledger (accounts project) replaces this with real quotas. */
import type { H3Event } from 'h3'

const buckets = new Map<string, { count: number; resetAt: number }>()

export function takeToken(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (b.count >= max) return false
  b.count += 1
  return true
}

export function _resetRateLimits(): void {
  buckets.clear()
}

/** Route guard: 30 calls/min per client IP per route by default. */
export function assertRateLimit(event: H3Event, name: string, max = 30, windowMs = 60_000): void {
  const ip = event.node.req.socket?.remoteAddress ?? 'local'
  if (!takeToken(`${name}:${ip}`, max, windowMs)) {
    throw Object.assign(new Error(`Too many ${name} requests — wait a minute and retry`), { statusCode: 429 })
  }
}
