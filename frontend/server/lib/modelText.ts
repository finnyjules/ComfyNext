/** Pull the text block out of an Anthropic messages response. An empty or
 *  text-free response is an upstream failure — surface it as 502 instead of
 *  returning '' for the client to mis-read as "the model proposed nothing". */
export function extractModelText(json: unknown): string {
  const content = (json as { content?: Array<{ text?: unknown }> } | null)?.content
  const text = Array.isArray(content)
    ? content.find(b => typeof b?.text === 'string' && b.text)?.text as string | undefined
    : undefined
  if (!text) throw Object.assign(new Error('Empty response from model'), { statusCode: 502 })
  return text
}
