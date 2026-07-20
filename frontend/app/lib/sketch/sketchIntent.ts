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

// "sketch me a dog on a couch" → "a dog on a couch". The fast-path fires the
// render with the user's RAW words before the classifier can distill them, so
// the draft/command wrapper ("sketch me", "draw a", "generate") leaks into the
// image prompt and the model literally draws a pencil sketch. Strip that wrapper
// from the SUBJECT — but ONLY when the text opens with an action verb, so an
// explicit style request ("a pencil sketch of a dog") is left untouched.
const ACTION_VERBS = new Set([
  'sketch', 'draw', 'generate', 'create', 'make', 'render', 'paint',
  'illustrate', 'design', 'show', 'give', 'produce', 'imagine', 'picture',
])
const WRAPPER_WORDS = new Set([
  // fillers + a single "picture/sketch of" wrapper noun
  'me', 'up', 'a', 'an', 'the', 'some', 'please', 'of',
  'quick', 'rough', 'fast', 'simple',
  'sketch', 'drawing', 'picture', 'image', 'photo', 'render', 'illustration', 'version',
])
const alpha = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '')

export function cleanSketchPrompt(text: string): string {
  const t = text.trim()
  const words = t.split(/\s+/)
  if (!words.length || !ACTION_VERBS.has(alpha(words[0]!))) return t
  let i = 1
  while (i < words.length && WRAPPER_WORDS.has(alpha(words[i]!))) i++
  const rest = words.slice(i).join(' ').trim()
  // Never strip to nothing — if the wrapper WAS the whole message, keep original.
  return rest.length >= 2 ? rest : t
}
