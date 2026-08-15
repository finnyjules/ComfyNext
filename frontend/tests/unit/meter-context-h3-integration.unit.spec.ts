import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import {
  __resetMeterContextForTests,
  bindMeterContext,
  clearMeterContext,
  currentMeterContext,
} from '../../server/utils/requestMeter'

/**
 * Integration regression for the ALS propagation gotcha documented in
 * requestMeter.ts's module doc. The unit-level regression test in
 * request-meter.unit.spec.ts reproduces the SHAPE of real h3 dispatch with
 * two hand-written async functions; this file drives the REAL h3 request
 * pipeline (createApp/toNodeListener) over a REAL HTTP socket, so it also
 * covers whatever h3 itself does around await boundaries — the assumption
 * the whole context-box design rests on: h3 invokes each registered
 * defineEventHandler DIRECTLY (no await-before-body wrapper in between),
 * so clearMeterContext's synchronous enterWith lands on h3's own dispatch
 * frame, not on some wrapper's descendant frame.
 */

async function withServer(
  app: ReturnType<typeof createApp>,
  fn: (origin: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(toNodeListener(app))
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address() as AddressInfo
    await fn(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('meter context over real h3 dispatch (integration)', () => {
  afterEach(() => {
    __resetMeterContextForTests()
  })

  it('a handler awaited separately from an auth-shaped middleware sees the context bound after the middleware\'s internal await', async () => {
    const app = createApp()

    // Mirrors auth.ts's shape exactly: clear FIRST (sync, before any
    // await), then an internal await (like resolveHostedUserId's network
    // call), then bind.
    app.use(defineEventHandler(async () => {
      clearMeterContext()
      await Promise.resolve()
      bindMeterContext({ userId: 'u_h3' })
    }))

    // Terminal handler — invoked via Nitro's/h3's own SEPARATE await from
    // the middleware above, with its own async gap before it reads the
    // context, exactly like a route handler awaiting a provider call.
    app.use(defineEventHandler(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { seen: currentMeterContext() }
    }))

    await withServer(app, async (origin) => {
      const res = await fetch(`${origin}/anything`)
      const body = await res.json()
      expect(body.seen).toEqual({ userId: 'u_h3' })
    })
  })

  it('a public-style request (clears but never binds) sees null, even right after a bound request on the same keep-alive connection', async () => {
    const app = createApp()

    app.use(defineEventHandler(async (event) => {
      clearMeterContext()
      if (event.path.startsWith('/public')) return // public short-circuit, no bind
      await Promise.resolve()
      bindMeterContext({ userId: 'u_h3_auth' })
    }))

    app.use(defineEventHandler(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return { seen: currentMeterContext() }
    }))

    await withServer(app, async (origin) => {
      // Sequential fetches to the same origin reuse Node's default
      // keep-alive connection pool — this is the SAME socket the second
      // (public) request rides in on.
      const authRes = await fetch(`${origin}/auth`)
      const authBody = await authRes.json()
      expect(authBody.seen).toEqual({ userId: 'u_h3_auth' })

      const pubRes = await fetch(`${origin}/public`)
      const pubBody = await pubRes.json()
      expect(pubBody.seen).toBeNull()
    })
  })
})
