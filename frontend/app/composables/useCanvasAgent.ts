/**
 * useCanvasAgent — the node-canvas agent (Phase 3, Slice 1). Handles BOTH:
 *  • questions about the graph → a plain answer (the "message" channel), and
 *  • edits to existing nodes (setWidget / setMode / deleteNode) → a proposal.
 *
 * Ghost-preview lifecycle: as the proposal is built/toggled, the accepted
 * commands are rendered on the canvas as semi-transparent pastel GHOSTS
 * (opts.preview); a dry-run over a CanvasSnapshot drives the health readout. On
 * Keep, opts.commit promotes the ghosts to real nodes/edges (+ a glimm sweep);
 * on Dismiss, opts.discard removes them.
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
  /** Render the accepted commands on the canvas as semi-transparent ghosts.
   *  animate plays the ~1s blueprint draw-in (used on the first proposal). */
  preview: (commands: Command[], animate?: boolean) => void
  /** Promote the ghosts to real nodes/edges (+ glimm). Called on Keep. */
  commit: () => void
  /** Remove the ghosts. Called on Dismiss. */
  discard: () => void
  /** Delegate tuneNode commands to each target node's OWN studio surface (applied
   *  in place). Returns proposal rows + an optional notice. */
  tune?: (cmds: { target: string; request: string }[]) => Promise<{ changes: ProposedChange[]; notice?: string }>
  /** Undo the in-place studio-tune edits. Called on Dismiss. */
  tuneRevert?: () => void
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

  const acceptedCommands = () => changes.value.filter(c => c.accepted).map(c => c.command)

  /** Re-derive the dry-run health readout AND refresh the on-canvas ghost preview
   *  from the currently-accepted commands. */
  function recompute() {
    if (!original) return
    let s = clone(original)
    for (const cmd of acceptedCommands()) {
      const r = applyCanvasCommand(s, cmd)
      if (r.ok) s = r.template
    }
    issues.value = verifyCanvas(s)
    opts.preview(acceptedCommands(), false) // ghosts on the canvas (instant — no re-blueprint on toggle)
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
    busy.value = true; error.value = ''; reasoning.value = ''; answer.value = ''; issues.value = []; lastPhrase.value = p
    opts.discard(); opts.tuneRevert?.(); changes.value = [] // clear any prior un-kept ghost / tune preview
    try {
      original = clone(opts.getSnapshot(p))
      const desc = describeCanvas(original)
      const { commands, changeRationales, message } = await callModel(buildAgentPrompt(desc, p), desc.commands)
      // Graph ops are ghost-previewed; tuneNode is delegated to a node's OWN studio
      // surface (e.g. a Frame's background) and applied in place.
      const graphBuilt: ProposedChange[] = []
      const tuneInputs: { target: string; request: string }[] = []
      let probe = clone(original)
      commands.forEach((cmd, i) => {
        if (cmd.op === 'tuneNode') {
          const req = typeof cmd.args?.request === 'string' ? cmd.args.request : ''
          if (cmd.target && req) tuneInputs.push({ target: cmd.target, request: req })
          return
        }
        const ch = buildChange(probe, cmd, changeRationales[i] ?? '')
        if (!ch) return
        graphBuilt.push(ch)
        const r = applyCanvasCommand(probe, cmd)
        if (r.ok) probe = r.template
      })
      // Graph-health readout is about graph structure — only when graph changed.
      issues.value = graphBuilt.length ? verifyCanvas(probe) : []
      // Blueprint first (for ADDED graph nodes) — this materialises the ghost nodes
      // AND populates the placeholder→real id map, so a tuneNode targeting a
      // just-added Frame ($new1) can resolve it. Keep `busy` true so the grid sparks
      // animate through the blueprint.
      if (graphBuilt.length) {
        opts.preview(graphBuilt.map(c => c.command), true)
        await new Promise(r => setTimeout(r, 1800)) // matches the blueprint duration
      }
      // Studio-tune delegations run AFTER the ghosts exist (applied in place).
      let tuneBuilt: ProposedChange[] = []
      let tuneNotice = ''
      if (tuneInputs.length && opts.tune) {
        const res = await opts.tune(tuneInputs)
        tuneBuilt = res.changes
        tuneNotice = res.notice ?? ''
      }
      const built = [...graphBuilt, ...tuneBuilt]
      if (!built.length) {
        answer.value = tuneNotice || message || (commands.length ? 'I couldn’t apply those edits to this graph.' : 'No changes for that — try rephrasing.')
        return
      }
      if (tuneNotice) answer.value = tuneNotice
      changes.value = built
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      opts.discard(); opts.tuneRevert?.()
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

  /** Commit: promote the on-canvas ghosts to real nodes/edges (+ glimm). */
  function keep() {
    opts.commit()
    changes.value = []; original = null; issues.value = []
  }
  /** Dismiss: remove the ghost preview + undo any in-place studio-tune edits. */
  function dismiss() { opts.discard(); opts.tuneRevert?.(); changes.value = []; original = null; issues.value = []; answer.value = '' }

  return { busy, error, reasoning, answer, changes, issues, hasProposal, hovered, lastPhrase, ask, acceptChange, rejectChange, reroll, keep, dismiss }
}
