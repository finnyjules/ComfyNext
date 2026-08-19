/**
 * Stage 7 Task 4: the admin controls route guard. /api/admin/* route files
 * each do their OWN admin check (console.get.ts's blanket 404 does not apply
 * to sibling files). Guard: hosted AND event.context.userId ===
 * ADMIN_CLERK_USER_ID, else 404 (not 403 — the route stays undiscoverable).
 *
 * The route handlers call defineEventHandler / createError / readBody at
 * module scope — Nitro auto-imports absent under plain vitest. Stub them
 * before dynamic import, per the wallet-route-shape.unit.spec.ts pattern.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.createError = (opts: any) => Object.assign(new Error(opts.statusMessage || 'error'), opts)

const ADMIN = 'ADMIN_CLERK_USER_ID'
const savedAdmin = process.env[ADMIN]

let getPayload: any
let applyControls: any

beforeAll(async () => {
  ;({ controlsGetPayload: getPayload } = await import('../../server/api/admin/controls.get'))
  ;({ applyControls } = await import('../../server/api/admin/controls.post'))
})

beforeEach(() => { process.env[ADMIN] = 'admin_1' })
afterEach(() => {
  if (savedAdmin === undefined) delete process.env[ADMIN]; else process.env[ADMIN] = savedAdmin
})

const getDeps = {
  getControls: vi.fn(async () => ({ globalPaused: false, disabledUsers: ['x'] })),
  getTodayCredits: vi.fn(async () => 12),
}

describe('controlsGetPayload guard', () => {
  it('non-admin user → 404, never reads controls', async () => {
    getDeps.getControls.mockClear()
    await expect(getPayload('hosted', 'someone_else', getDeps)).rejects.toMatchObject({ statusCode: 404 })
    expect(getDeps.getControls).not.toHaveBeenCalled()
  })

  it('local mode → 404 (route is hosted-only)', async () => {
    await expect(getPayload('local', 'admin_1', getDeps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('no ADMIN_CLERK_USER_ID configured → 404 even for a matching-looking id', async () => {
    delete process.env[ADMIN]
    await expect(getPayload('hosted', 'admin_1', getDeps)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('admin → returns controls, today credits, and the ceiling', async () => {
    process.env.SAILOR_DAILY_CREDIT_CEILING = '500'
    const out = await getPayload('hosted', 'admin_1', getDeps)
    expect(out).toEqual({ globalPaused: false, disabledUsers: ['x'], todayCredits: 12, ceiling: 500 })
    delete process.env.SAILOR_DAILY_CREDIT_CEILING
  })
})

describe('applyControls guard + actions', () => {
  const deps = { setGlobalPaused: vi.fn(async () => {}), setUserDisabled: vi.fn(async () => {}) }
  beforeEach(() => { deps.setGlobalPaused.mockClear(); deps.setUserDisabled.mockClear() })

  it('non-admin → 404, no setter called', async () => {
    await expect(applyControls('hosted', 'nope', { globalPaused: true }, deps)).rejects.toMatchObject({ statusCode: 404 })
    expect(deps.setGlobalPaused).not.toHaveBeenCalled()
  })

  it('admin: globalPaused toggles the pause', async () => {
    expect(await applyControls('hosted', 'admin_1', { globalPaused: true }, deps)).toEqual({ ok: true })
    expect(deps.setGlobalPaused).toHaveBeenCalledWith(true)
  })

  it('admin: disableUser / enableUser route to setUserDisabled', async () => {
    await applyControls('hosted', 'admin_1', { disableUser: 'u5' }, deps)
    expect(deps.setUserDisabled).toHaveBeenCalledWith('u5', true)
    deps.setUserDisabled.mockClear()
    await applyControls('hosted', 'admin_1', { enableUser: 'u5' }, deps)
    expect(deps.setUserDisabled).toHaveBeenCalledWith('u5', false)
  })

  it('admin: an empty body is a no-op that still 200s', async () => {
    expect(await applyControls('hosted', 'admin_1', {}, deps)).toEqual({ ok: true })
    expect(deps.setGlobalPaused).not.toHaveBeenCalled()
    expect(deps.setUserDisabled).not.toHaveBeenCalled()
  })
})
