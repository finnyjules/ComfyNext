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
  const moderation = data.statusCode === 400
  return {
    title: data.message,
    description: moderation ? 'See our content policy for what’s allowed.' : undefined,
    policyLink: moderation,
  }
}
