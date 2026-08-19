/** Recognizes the auth middleware's private-beta refusal (Stage 8).
 * Checks both h3 body nestings (`data.data.code` and `data.code`) because
 * the serialized error payload shape differs between h3 versions. */
export function isBetaGateError(e: unknown): boolean {
  const err = e as { statusCode?: number; data?: { code?: string; data?: { code?: string } } } | null
  if (!err || err.statusCode !== 403) return false
  const code = err.data?.data?.code ?? err.data?.code
  return code === 'beta_not_invited'
}
