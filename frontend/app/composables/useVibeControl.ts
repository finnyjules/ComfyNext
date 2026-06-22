import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'

export function useVibeControl() {
  const { getLocalSetting } = useLocalSettings()

  async function requestPatch(
    controls: ControlSpec[],
    params: Params,
    effectLabel: string,
    phrase: string,
  ): Promise<{ patch: Record<string, ParamValue>; rationale: string }> {
    const apiKey = getLocalSetting('ComfyNext.AI.AnthropicApiKey')
    if (!apiKey) throw new Error('No Anthropic API key set. Add your key in Settings → AI.')

    const described = describeControls(controls, params)
    if (!described.length) throw new Error('This effect has no AI-adjustable controls.')

    const res = await $fetch<{ changes: { key: string; value: ParamValue }[]; rationale: string }>('/api/vibe', {
      method: 'POST',
      body: { apiKey, controls: described, phrase, effectLabel },
    })

    const raw: Record<string, ParamValue> = {}
    for (const c of res.changes ?? []) raw[c.key] = c.value
    const patch = validatePatch(raw, described)
    return { patch, rationale: res.rationale ?? '' }
  }

  return { requestPatch }
}
