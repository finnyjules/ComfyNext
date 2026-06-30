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
import type { ProposedChange, VisualReview } from '~/composables/useLayoutAgent'
import { applyCanvasCommand, describeCanvas, summarizeCanvasChange, verifyCanvas, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import { buildAgentPrompt, buildCommandSchema, buildResultReviewPrompt, buildReviewSchema, parseAgentResponse, parseReviewResponse } from '~/lib/agent/protocol'
import type { LayoutIssue } from '~/lib/agent/verify'
import { useAgentActivity } from '~/composables/useAgentActivity'

const REROLLABLE = new Set(['setWidget', 'setMode', 'addNode'])
const clone = (s: CanvasSnapshot): CanvasSnapshot => JSON.parse(JSON.stringify(s)) as CanvasSnapshot

export function useCanvasAgent(opts: {
  /** phrase lets the snapshot tailor its node palette (catalog) to the request. */
  getSnapshot: (phrase?: string) => CanvasSnapshot
  /** Render the accepted commands on the canvas as semi-transparent ghosts.
   *  animate plays the ~1s blueprint draw-in (used on the first proposal). */
  preview: (commands: Command[], animate?: boolean) => void
  /** Promote the ghosts to real nodes/edges (+ glimm). Called on Keep. Returns the
   *  ids of the nodes it committed (so Keep & Run can run them). */
  commit: () => string[] | void
  /** Run the given nodes (Keep & Run). Optional — only the canvas surface runs. */
  run?: (targetIds: string[]) => void
  /** The run's output image as a data URL, for the run→look→fix review loop. */
  runOutputImage?: (targetIds: string[]) => Promise<string | null>
  /** Resolve review targets → the OUTPUT/result node id (past a generator to its
   *  result card), so the "scanning" overlay lands on the output, not the generator. */
  resolveResultNode?: (targetIds: string[]) => string | null
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
  /** Run→look→fix: a designer's-eye critique of the RUN's actual output. */
  const review = ref<VisualReview | null>(null)
  const reviewing = ref(false)
  /** Shared set of node ids under review — drives each node's scanning overlay. */
  const { analyzingNodeIds } = useAgentActivity()
  /** Set by Keep & Run; consumed once when the run completes. */
  let pendingReview: { targets: string[]; intent: string } | null = null
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

  /** The nodes a Keep should be able to run: the just-committed (added/tuned) nodes
   *  plus any existing node a setWidget/setMode/tuneNode targeted. Excludes deletes
   *  and unresolved "$new" placeholders (committed ids already cover added nodes). */
  function runTargets(committed: string[]): string[] {
    const touched = changes.value
      .filter(c => ['setWidget', 'setMode', 'tuneNode'].includes(c.command.op))
      .map(c => c.command.target)
      .filter((t): t is string => typeof t === 'string' && !t.startsWith('$'))
    return Array.from(new Set([...committed, ...touched]))
  }

  /** Commit: promote the on-canvas ghosts to real nodes/edges (+ glimm). */
  async function keep() {
    opts.commit()
    changes.value = []; original = null; issues.value = []; review.value = null
  }
  /** Keep, then run the resulting node(s) — one click for the common build→run flow. */
  async function keepAndRun() {
    const committed = opts.commit() || []
    const targets = runTargets(committed)
    const intent = lastPhrase.value
    changes.value = []; original = null; issues.value = []; review.value = null
    if (targets.length) {
      opts.run?.(targets)
      // Arm the run→look→fix loop: when this run finishes, review its output.
      if (opts.runOutputImage) pendingReview = { targets, intent }
    }
  }

  /** Run→look→fix core (suggest-only): look at a run's actual output for `targets`,
   *  and if it falls short of `intent` propose fixes as Keep/Dismiss cards. The user
   *  decides — nothing is auto-applied or auto-re-run. Used by the Keep & Run loop
   *  AND by on-demand "Critique" on any result node. */
  async function runReview(targets: string[], intent: string, manual = false) {
    if (busy.value || reviewing.value || !opts.runOutputImage) return
    opts.discard(); opts.tuneRevert?.(); changes.value = []; review.value = null; answer.value = ''; error.value = ''
    reviewing.value = true
    // Mark the OUTPUT node under review so the white "scanning" overlay lands on
    // the result (past a generator to its result card), not the generator itself.
    const resultNode = opts.resolveResultNode?.(targets)
    analyzingNodeIds.value = new Set(resultNode ? [resultNode] : targets.map(String))
    try {
      const image = await opts.runOutputImage(targets)
      if (!image) { if (manual) answer.value = 'No result on that node yet — run it first, then critique.'; return }
      const snap = clone(opts.getSnapshot(intent))
      original = snap
      const desc = describeCanvas(snap)
      const res = await $fetch<{ text: string }>('/api/agent-review', {
        method: 'POST',
        body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt: buildResultReviewPrompt(desc, intent), schema: buildReviewSchema(desc.commands), image },
        timeout: 60_000,
      })
      const { assessment, issues: found, fixes, fixRationales } = parseReviewResponse(res.text)
      review.value = { assessment, issues: found }
      const built: ProposedChange[] = []
      let probe = clone(snap)
      fixes.forEach((cmd, i) => {
        const ch = buildChange(probe, cmd, fixRationales[i] || 'From the visual review')
        if (!ch) return
        ch.fromReview = true
        built.push(ch)
        const r = applyCanvasCommand(probe, cmd)
        if (r.ok) probe = r.template
      })
      if (built.length) { changes.value = built; recompute() }
      else if (!found.length) answer.value = '✓ Looks right — the result matches what you asked.'
    } catch (e) { if (manual) error.value = e instanceof Error ? e.message : 'Couldn’t review the result.' }
    finally { reviewing.value = false; analyzingNodeIds.value = new Set() }
  }

  /** Auto: fires when a Keep & Run finishes (a review is armed). */
  async function reviewLastRun() {
    if (!pendingReview) return
    const { targets, intent } = pendingReview
    pendingReview = null // one pass; the user re-arms by Keep & Run-ing a fix
    await runReview(targets, intent)
  }

  /** On-demand: critique ANY result node (its output vs the prompt that made it). */
  async function reviewNode(nodeId: string, intent: string) {
    await runReview([nodeId], intent || 'this image', true)
  }
  /** Dismiss: remove the ghost preview + undo any in-place studio-tune edits. */
  function dismiss() { opts.discard(); opts.tuneRevert?.(); changes.value = []; original = null; issues.value = []; answer.value = ''; review.value = null; pendingReview = null }

  return { busy, error, reasoning, answer, changes, issues, review, reviewing, hasProposal, hovered, lastPhrase, ask, acceptChange, rejectChange, reroll, keep, keepAndRun, reviewLastRun, reviewNode, dismiss }
}
