/**
 * useCanvasAgent — the node-canvas agent. Slice 0 is READ-ONLY: it answers
 * questions about the current graph (perceive + explain), no mutations. It reads
 * the graph through getSnapshot() (the canvas owns the Vue Flow refs), describes
 * it, asks the model, and surfaces a plain-language answer + a passive
 * graph-health readout. Later slices add a command catalog + apply/proposal
 * (see docs/agent-canvas-surface-scope.md).
 */
import { ref } from 'vue'
import { $fetch } from 'ofetch'
import { buildCanvasAnswerSchema, buildCanvasQuestionPrompt, parseCanvasAnswer, verifyCanvas, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import type { LayoutIssue } from '~/lib/agent/verify'

export function useCanvasAgent(opts: { getSnapshot: () => CanvasSnapshot; apiKey: () => string; tier?: string }) {
  const busy = ref(false)
  const error = ref('')
  const reasoning = ref('')
  const answer = ref('')
  const issues = ref<LayoutIssue[]>([])
  const lastQuestion = ref('')

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy.value) return
    if (!opts.apiKey()) { error.value = 'Add your Anthropic key in Settings → AI to ask about the graph.'; return }
    busy.value = true; error.value = ''; reasoning.value = ''; answer.value = ''; lastQuestion.value = q
    try {
      const snapshot = opts.getSnapshot()
      issues.value = verifyCanvas(snapshot)
      const res = await $fetch<{ text: string }>('/api/agent-plan', {
        method: 'POST',
        body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt: buildCanvasQuestionPrompt(snapshot, q), schema: buildCanvasAnswerSchema() },
        timeout: 60_000,
      })
      const parsed = parseCanvasAnswer(res.text)
      reasoning.value = parsed.reasoning
      answer.value = parsed.answer || 'I couldn’t read an answer for that — try rephrasing.'
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  function clear() { answer.value = ''; reasoning.value = ''; error.value = ''; issues.value = [] }

  return { busy, error, reasoning, answer, issues, lastQuestion, ask, clear }
}
