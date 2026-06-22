/**
 * Compose a trained-LoRA generation prompt from its sidecar style + the user's
 * text, mirroring the style branch of lora-cover.post.ts:
 *   "<aesthetic> <trigger>, <userPrompt>"
 * Any empty part is dropped. Returned string is trimmed.
 */
export function buildLoraPrompt(trigger: string, aesthetic: string, userPrompt: string): string {
  const t = (trigger || '').trim()
  const a = (aesthetic || '').trim()
  const p = (userPrompt || '').trim()
  return [a, t ? `${t},` : '', p].filter(Boolean).join(' ').trim()
}
