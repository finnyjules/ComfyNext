import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import type { StudioTake } from '~/lib/agent/takes'

/** What a multi-take ask came back with. Exactly one of `takes` (two or more
 *  survived validation) or `patch` is useful — `patch` is set when the server
 *  answered in the OLD single-patch shape, which is how a deployment that
 *  predates `variants` replies, and lets the caller degrade without paying for
 *  a second call. */
export interface VibeTakesReply {
  /** The controls as they were described to the model — the caller needs these
   *  for the local neighbour spread, so it is handed them rather than
   *  re-deriving them (and risking a different list). */
  described: DescribedControl[]
  takes: StudioTake[]
  patch?: Record<string, ParamValue>
  rationale?: string
}

export function useVibeControl() {
  const { getLocalSetting } = useLocalSettings()

  async function requestPatch(
    controls: ControlSpec[],
    params: Params,
    effectLabel: string,
    phrase: string,
    guidance?: string,
  ): Promise<{ patch: Record<string, ParamValue>; rationale: string }> {
    const apiKey = getLocalSetting('Sailor.AI.AnthropicApiKey')

    const described = describeControls(controls, params)
    if (!described.length) throw new Error('This effect has no AI-adjustable controls.')

    const res = await $fetch<{ changes: { key: string; value: ParamValue }[]; rationale: string }>('/api/vibe', {
      method: 'POST',
      body: { apiKey: apiKey || undefined, controls: described, phrase, effectLabel, guidance },
    })

    const raw: Record<string, ParamValue> = {}
    for (const c of res.changes ?? []) raw[c.key] = c.value
    const patch = validatePatch(raw, described)
    return { patch, rationale: res.rationale ?? '' }
  }

  /**
   * The same ask, in `variants` genuinely different readings (Four Takes). The
   * ONLY difference on the wire is the `variants` field — everything else, the
   * controls description and the clamping on the way back, is the single-patch
   * path's own machinery, so a take can never carry a value the studio could not
   * have reached by hand.
   *
   * Never assumes it got takes: a server that does not know the field answers in
   * the single-patch shape, and that answer is handed back as `patch` rather
   * than thrown away.
   */
  async function requestTakes(
    controls: ControlSpec[],
    params: Params,
    effectLabel: string,
    phrase: string,
    guidance?: string,
    variants = 4,
  ): Promise<VibeTakesReply> {
    const apiKey = getLocalSetting('Sailor.AI.AnthropicApiKey')

    const described = describeControls(controls, params)
    if (!described.length) throw new Error('This effect has no AI-adjustable controls.')

    const res = await $fetch<{
      takes?: { label: string; changes: { key: string; value: ParamValue }[]; rationale?: string }[]
      changes?: { key: string; value: ParamValue }[]
      rationale?: string
    }>('/api/vibe', {
      method: 'POST',
      body: { apiKey: apiKey || undefined, controls: described, phrase, effectLabel, guidance, variants },
    })

    if (Array.isArray(res?.takes)) {
      const takes: StudioTake[] = []
      for (const t of res.takes) {
        const raw: Record<string, ParamValue> = {}
        for (const c of t.changes ?? []) raw[c.key] = c.value
        const valid = validatePatch(raw, described)
        const changes = Object.entries(valid).map(([key, value]) => ({ key, value }))
        // A take that survives with nothing to change IS the current config;
        // showing it as an alternative would be a lie.
        if (!changes.length) continue
        takes.push({ label: t.label, changes, rationale: t.rationale ?? '' })
      }
      return { described, takes }
    }

    const raw: Record<string, ParamValue> = {}
    for (const c of res?.changes ?? []) raw[c.key] = c.value
    return { described, takes: [], patch: validatePatch(raw, described), rationale: res?.rationale ?? '' }
  }

  return { requestPatch, requestTakes }
}
