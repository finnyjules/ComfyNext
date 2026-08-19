/**
 * Pull the human-authored prompt text out of a ComfyUI API-format graph for
 * moderation. Only known prompt-bearing input names; node-link values
 * (arrays) and non-strings skipped.
 */
const PROMPT_INPUT_NAMES = new Set(['prompt', 'text', 'positive', 'negative'])
export function extractGraphPromptText(prompt: Record<string, { class_type: string; inputs?: any }>): string {
  const parts: string[] = []
  for (const node of Object.values(prompt ?? {})) {
    const inputs = node?.inputs
    if (!inputs || typeof inputs !== 'object') continue
    for (const [name, value] of Object.entries(inputs)) {
      if (PROMPT_INPUT_NAMES.has(name) && typeof value === 'string' && value.trim()) parts.push(value)
    }
  }
  return parts.join(' ')
}

/**
 * Pull the moderatable prompt text out of a provider-route input dict (the
 * argument to runReplicate / runFal). Prefer the obvious `prompt`/`text`
 * field; otherwise moderate the concatenation of the input's string values so
 * a prompt hiding under another key is still seen. Non-strings are skipped.
 */
export function extractProviderPromptText(input: Record<string, unknown>): string {
  if (!input || typeof input !== 'object') return ''
  const direct = (input as any).prompt ?? (input as any).text
  if (typeof direct === 'string') return direct
  return Object.values(input).filter((v): v is string => typeof v === 'string').join(' ')
}
