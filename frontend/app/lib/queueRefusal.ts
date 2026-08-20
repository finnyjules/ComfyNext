/** Toast copy for a bridge `queue_error` that is a Nuxt-proxy metering
 * refusal (moderation / credits / ownership / paused) rather than a
 * ComfyUI validation error. Returns null for the latter — those are
 * handled by the existing per-node red-ring path. */
export interface QueueRefusalNotice {
  title: string
  description: string | undefined
  policyLink: boolean
}

export function describeQueueRefusal(data: { refusal?: boolean; statusCode?: number | null; message?: string }): QueueRefusalNotice | null {
  if (!data?.refusal || typeof data.message !== 'string' || !data.message) return null
  // statusCode 400 alone isn't enough — the chokepoint also 400s non-moderation
  // failures (e.g. 'Missing prompt graph'), which must NOT get the policy link.
  const moderation = data.statusCode === 400 && /moderation/i.test(data.message)
  return {
    title: data.message,
    description: moderation ? 'See our content policy for what’s allowed.' : undefined,
    policyLink: moderation,
  }
}
