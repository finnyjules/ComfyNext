/**
 * Operator safety-valve readout (Stage 7 Task 4) — the current global pause
 * flag, the disabled-user list, today's summed ledger debit credits, and the
 * configured daily ceiling. Hosted-only, admin-only.
 *
 * This file does its OWN admin check: sibling /api/admin routes (console.get)
 * 404 the whole prefix in hosted, but Nitro routes each file independently, so
 * that blanket check does NOT cover this handler — it must self-guard. The
 * guard 404s (never 403) so the route stays undiscoverable to non-admins.
 */
import { deployMode, type DeployMode } from '~~/server/utils/deployMode'
import { getControls, getTodayCredits } from '~~/server/utils/systemControls'

export function assertAdmin(mode: DeployMode, userId: string | null): void {
  const admin = process.env.ADMIN_CLERK_USER_ID
  if (mode !== 'hosted' || !admin || userId !== admin)
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

interface ControlsGetDeps {
  getControls(): Promise<{ globalPaused: boolean; disabledUsers: string[] }>
  getTodayCredits(): Promise<number>
}

export async function controlsGetPayload(
  mode: DeployMode,
  userId: string | null,
  deps: ControlsGetDeps,
): Promise<{ globalPaused: boolean; disabledUsers: string[]; todayCredits: number; ceiling: number }> {
  assertAdmin(mode, userId)
  const controls = await deps.getControls()
  const todayCredits = await deps.getTodayCredits()
  return {
    globalPaused: controls.globalPaused,
    disabledUsers: controls.disabledUsers,
    todayCredits,
    ceiling: Number(process.env.SAILOR_DAILY_CREDIT_CEILING || 0),
  }
}

export default defineEventHandler(async (event) => {
  return controlsGetPayload(deployMode(), event.context.userId ?? null, { getControls, getTodayCredits })
})
