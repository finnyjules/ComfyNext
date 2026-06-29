/**
 * useCanvasAgent — the node-canvas agent (Phase 3, Slice 1). Handles BOTH:
 *  • questions about the graph → a plain answer (the "message" channel), and
 *  • edits to existing nodes (setWidget / setMode / deleteNode) → a proposal.
 *
 * Plan-then-materialise: graph mutations aren't pure JSON, so the proposal is a
 * DRY-RUN over a CanvasSnapshot (preview + validation only — the live graph is
 * never touched as you accept/reject). On Keep, opts.materialise applies the
 * accepted commands to the real graph (where the canvas's own deep-watch history
 * gives undo for free). Dismiss leaves the graph exactly as it was.
 */
import { computed, ref } from 'vue'
import { $fetch } from 'ofetch'
import type { Command } from '~/lib/agent/commandSurface'
import type { ProposedChange } from '~/composables/useLayoutAgent'
import { applyCanvasCommand, describeCanvas, summarizeCanvasChange, verifyCanvas, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import { buildAgentPrompt, buildCommandSchema, parseAgentResponse } from '~/lib/agent/protocol'
import type { LayoutIssue } from '~/lib/agent/verify'

const REROLLABLE = new Set(['setWidget', 'setMode', 'addNode'])
const clone = (s: CanvasSnapshot): CanvasSnapshot => JSON.parse(JSON.stringify(s)) as CanvasSnapshot

export function useCanvasAgent(opts: {
  /** phrase lets the snapshot tailor its node palette (catalog) to the request. */
  getSnapshot: (phrase?: string) => CanvasSnapshot
  materialise: (commands: Command[]) => void
  apiKey: () => string
  tier?: string
}) {
  const busy = ref(false)
  const error = ref('')
  const reasoning = ref('')
  /** Plain-language answer for questions / out-of-scope asks (no commands). */
  const answer = ref('')
  const changes = ref<ProposedChange[]>([])
  const issues = ref<LayoutIssue[]>([])
  const hovered = ref<number | null>(null)
  const lastPhrase = ref('')
  let original: CanvasSnapshot | null = null
  const hasProposal = computed(() => changes.value.length > 0)

  async function callModel(prompt: string, commands: { op: string }[]) {
    const res = await $fetch<{ text: string }>('/api/agent-plan', {
      method: 'POST',
      body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt, schema: buildCommandSchema(commands) },
      timeout: 60_000,
    })
    const parsed = parseAgentResponse(res.text)
    reasoning.value = parsed.reasoning
    return parsed
  }

  /** Re-run the DRY-RUN preview: predicted snapshot from accepted commands, for
   *  the health readout. Never touches the live graph. */
  function recompute() {
    if (!original) return
    let s = clone(original)
    for (const ch of changes.value) {
      if (!ch.accepted) continue
      const r = applyCanvasCommand(s, ch.command)
      if (r.ok) s = r.template
    }
    issues.value = verifyCanvas(s)
  }

  function buildChange(probe: CanvasSnapshot, cmd: Command, rationale: string): ProposedChange | null {
    if (!applyCanvasCommand(probe, cmd).ok) return null
    const sum = summarizeCanvasChange(probe, cmd) ?? { label: cmd.op, before: '', after: '' }
    return { command: cmd, label: sum.label, before: sum.before, after: sum.after, rationale, rerollable: REROLLABLE.has(cmd.op), accepted: true }
  }

  async function ask(phrase: string) {
    const p = phrase.trim()
    if (!p || busy.value) return
    if (!opts.apiKey()) { error.value = 'Add your Anthropic key in Settings → AI.'; return }
    busy.value = true; error.value = ''; reasoning.value = ''; answer.value = ''; changes.value = []; issues.value = []; lastPhrase.value = p
    try {
      original = clone(opts.getSnapshot(p))
      const desc = describeCanvas(original)
      const { commands, changeRationales, message } = await callModel(buildAgentPrompt(desc, p), desc.commands)
      const built: ProposedChange[] = []
      let probe = clone(original)
      commands.forEach((cmd, i) => {
        const ch = buildChange(probe, cmd, changeRationales[i] ?? '')
        if (!ch) return
        built.push(ch)
        const r = applyCanvasCommand(probe, cmd)
        if (r.ok) probe = r.template
      })
      changes.value = built
      if (!built.length) answer.value = message || (commands.length ? 'I couldn’t apply those edits to this graph.' : 'No changes for that — try rephrasing.')
      recompute()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  function acceptChange(i: number) { const c = changes.value[i]; if (c) { c.accepted = true; recompute() } }
  function rejectChange(i: number) { const c = changes.value[i]; if (c) { c.accepted = false; recompute() } }

  async function reroll(i: number) {
    const ch = changes.value[i]
    if (!ch || !ch.rerollable || !original || busy.value) return
    busy.value = true; error.value = ''
    try {
      const nonce = Math.random().toString(36).slice(2, 7)
      const intent = lastPhrase.value ? `The user's original request was: "${lastPhrase.value}". ` : ''
      const phrase = `${intent}Re-roll ONLY the "${ch.label}" change (currently "${ch.after}"). Propose a DIFFERENT value that still satisfies the request — not "${ch.after}". Same op "${ch.command.op}"${ch.command.target ? ` on "${ch.command.target}"` : ''}; change nothing else. (variation ${nonce})`
      const rdesc = describeCanvas(opts.getSnapshot(lastPhrase.value))
      const { commands, changeRationales } = await callModel(buildAgentPrompt(rdesc, phrase), rdesc.commands)
      const idx = commands.findIndex(c => c.op === ch.command.op && (c.target ?? '') === (ch.command.target ?? ''))
      const next = idx >= 0 ? commands[idx] : commands[0]
      if (next) {
        const rebuilt = buildChange(clone(original), next, (idx >= 0 ? changeRationales[idx] : changeRationales[0]) ?? ch.rationale)
        if (rebuilt) { rebuilt.accepted = ch.accepted; changes.value.splice(i, 1, rebuilt) }
      }
      recompute()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  /** Commit: materialise the accepted commands onto the live graph. */
  function keep() {
    const accepted = changes.value.filter(c => c.accepted).map(c => c.command)
    if (accepted.length) opts.materialise(accepted)
    changes.value = []; original = null; issues.value = []
  }
  /** Dismiss: the graph was never touched, so just clear the proposal. */
  function dismiss() { changes.value = []; original = null; issues.value = []; answer.value = '' }

  return { busy, error, reasoning, answer, changes, issues, hasProposal, hovered, lastPhrase, ask, acceptChange, rejectChange, reroll, keep, dismiss }
}
