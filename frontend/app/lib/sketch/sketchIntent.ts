/**
 * Fast-path gate: is this prompt-bar text a high-confidence IMAGE IDEA we can
 * render immediately (before the LLM classifier resolves), vs. a graph edit or
 * a question we must let the classifier decide? Conservative on purpose — a
 * miss just costs a ~1s wait; a false positive spends ~$0.01. (spec §6 lever 2)
 */
const EDIT_VERBS = new Set([
  'add', 'remove', 'delete', 'change', 'make', 'set', 'connect', 'blur', 'move',
  'turn', 'undo', 'fix', 'wire', 'rename', 'swap', 'replace', 'increase', 'decrease',
  'crop', 'rotate', 'select', 'group', 'align', 'go',
])
const QUESTION_WORDS = new Set([
  'what', 'why', 'how', 'where', 'which', 'who', 'can', 'does', 'is', 'are', 'do', 'should',
])

export function looksLikeImageIdea(text: string, graphIsEmpty: boolean): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (t.endsWith('?')) return false
  const words = t.split(/\s+/)
  const first = words[0]!
  if (EDIT_VERBS.has(first)) return false
  if (QUESTION_WORDS.has(first)) return false
  if (graphIsEmpty) return true
  // Non-empty graph: only fire on a short, descriptive phrase.
  return words.length <= 12
}
