/**
 * Operator safety-valve mutations (Stage 7 Task 4) — flip the global pause or
 * add/remove a user from the disable set. Hosted-only, admin-only.
 *
 * Self-guards exactly like controls.get.ts: each /api/admin file runs its own
 * admin check (Nitro routes them independently; console.get's blanket 404 does
 * not cover this handler). Non-admins get a 404, never a 403.
 */
import { deployMode, type DeployMode } from '~~/server/utils/deployMode'
import { setGlobalPaused, setUserDisabled } from '~~/server/utils/systemControls'
import { assertAdmin } from './controls.get'

interface ControlsPostBody {
  globalPaused?: boolean
  disableUser?: string
  enableUser?: string
}

interface ControlsPostDeps {
  setGlobalPaused(paused: boolean): Promise<void>
  setUserDisabled(userId: string, disabled: boolean): Promise<void>
}

export async function applyControls(
  mode: DeployMode,
  userId: string | null,
  body: ControlsPostBody,
  deps: ControlsPostDeps,
): Promise<{ ok: true }> {
  assertAdmin(mode, userId)
  if (typeof body?.globalPaused === 'boolean') await deps.setGlobalPaused(body.globalPaused)
  if (typeof body?.disableUser === 'string' && body.disableUser) await deps.setUserDisabled(body.disableUser, true)
  if (typeof body?.enableUser === 'string' && body.enableUser) await deps.setUserDisabled(body.enableUser, false)
  return { ok: true }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({})) as ControlsPostBody
  return applyControls(deployMode(), event.context.userId ?? null, body, { setGlobalPaused, setUserDisabled })
})
