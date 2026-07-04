/**
 * useTextureAgent — the in-product agent for the Texture studio. Same loop as
 * useCompositorAgent (describe → /api/agent-plan → parse → per-change proposal →
 * keep/revert), over a TextureState (the studio's Params, which carry per-role
 * `.fills`). Unlike the other studios' tune agent (useStudioAgent, single-key
 * param patches via /api/vibe), this is STRUCTURAL: it edits per-role fills AND
 * tunes flat controls through the shared command-surface protocol — so "make the
 * ground a sunset gradient" and "tighten the cells" go through one agent.
 */
import { computed, ref } from 'vue'
import { $fetch } from 'ofetch'
import type { Command } from '~/lib/agent/commandSurface'
import type { ProposedChange, VisualReview } from '~/composables/useLayoutAgent'
import { applyTextureCommand, describeTexture, summarizeTextureChange, verifyTexture, type TextureState } from '~/lib/agent/surfaces/texture'
import { buildAgentPrompt, buildCommandSchema, buildReviewPrompt, buildReviewSchema, parseAgentResponse, parseReviewResponse } from '~/lib/agent/protocol'
import type { LayoutIssue } from '~/lib/agent/verify'

const REROLLABLE = new Set(['setFillColor', 'setFillGradient', 'setFill', 'setParam'])
const clone = (s: TextureState): TextureState => JSON.parse(JSON.stringify(s)) as TextureState

export function useTextureAgent(opts: { getState: () => TextureState; setState: (s: TextureState) => void; apiKey: () => string; tier?: string; render?: () => string | null }) {
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const reasoning = ref('')
  const lastPhrase = ref('')
  const changes = ref<ProposedChange[]>([])
  const issues = ref<LayoutIssue[]>([])
  /** The visual self-review: a designer's-eye critique of the rendered tile. */
  const review = ref<VisualReview | null>(null)
  const reviewing = ref(false)
  const hovered = ref<number | null>(null)
  let original: TextureState | null = null
  const hasProposal = computed(() => changes.value.length > 0)

  async function callModel(prompt: string) {
    const snapshot = describeTexture(opts.getState())
    const schema = buildCommandSchema(snapshot.commands)
    const res = await $fetch<{ text: string }>('/api/agent-plan', {
      method: 'POST',
      body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt, schema },
      timeout: 60_000,
    })
    const parsed = parseAgentResponse(res.text)
    if (parsed.parseFailed) throw new Error('The model reply could not be read — please try again.')
    reasoning.value = parsed.reasoning
    return parsed
  }

  function recompute() {
    if (!original) return
    let s = clone(original)
    for (const ch of changes.value) {
      if (!ch.accepted) continue
      const r = applyTextureCommand(s, ch.command)
      if (r.ok) s = r.template
    }
    opts.setState(s)
    issues.value = verifyTexture(s)
  }

  function buildChange(probe: TextureState, cmd: Command, rationale: string): ProposedChange | null {
    if (!applyTextureCommand(probe, cmd).ok) return null
    const sum = summarizeTextureChange(probe, cmd) ?? { label: cmd.op, before: '', after: '' }
    return { command: cmd, label: sum.label, before: sum.before, after: sum.after, rationale, rerollable: REROLLABLE.has(cmd.op), accepted: true }
  }

  /** Visual self-review: render the tile, let a multimodal model critique it,
   *  surface findings + append fix commands as fromReview changes. Best-effort. */
  async function runVisualReview(intent: string) {
    if (!opts.render) return
    reviewing.value = true
    try {
      const image = opts.render()
      if (!image || !original) return
      const snapshot = describeTexture(opts.getState())
      const schema = buildReviewSchema(snapshot.commands)
      const res = await $fetch<{ text: string }>('/api/agent-review', {
        method: 'POST',
        body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt: buildReviewPrompt(snapshot, intent), schema, image },
        timeout: 60_000,
      })
      const parsed = parseReviewResponse(res.text)
      if (parsed.parseFailed) throw new Error('The model reply could not be read — please try again.')
      const { assessment, issues: found, fixes, fixRationales } = parsed
      review.value = { assessment, issues: found }
      if (fixes.length) {
        let probe = clone(opts.getState())
        fixes.forEach((cmd, i) => {
          const ch = buildChange(probe, cmd, fixRationales[i] || 'Visual review fix')
          if (!ch) return
          ch.fromReview = true
          changes.value = [...changes.value, ch]
          const r = applyTextureCommand(probe, cmd)
          if (r.ok) probe = r.template
        })
        recompute()
      }
    } catch { /* review is best-effort */ }
    finally { reviewing.value = false }
  }

  async function ask(phrase: string) {
    const p = phrase.trim()
    if (!p || busy.value) return
    busy.value = true; error.value = ''; notice.value = ''; reasoning.value = ''; issues.value = []; review.value = null; lastPhrase.value = p
    try {
      original = clone(opts.getState())
      const { commands, changeRationales, message } = await callModel(buildAgentPrompt(describeTexture(original), p))
      const built: ProposedChange[] = []
      let probe = clone(original)
      commands.forEach((cmd, i) => {
        const ch = buildChange(probe, cmd, changeRationales[i] ?? '')
        if (!ch) return
        built.push(ch)
        const r = applyTextureCommand(probe, cmd)
        if (r.ok) probe = r.template
      })
      changes.value = built
      if (!built.length) {
        if (message) notice.value = message
        else error.value = commands.length ? 'The agent proposed changes, but none applied to this texture.' : 'No changes proposed for that request.'
      } else if (message) notice.value = message
      recompute()
      if (built.length) void runVisualReview(p) // fire-and-forget: proposal shows now, review catches up
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      if (original) opts.setState(original)
    } finally {
      busy.value = false
    }
  }

  function acceptChange(i: number) { const c = changes.value[i]; if (c) { c.accepted = true; recompute() } }
  function rejectChange(i: number) { const c = changes.value[i]; if (c) { c.accepted = false; recompute() } }

  async function reroll(i: number) {
    const ch = changes.value[i]
    if (!ch || !ch.rerollable || !original || busy.value) return
    busy.value = true; error.value = ''; reasoning.value = ''
    try {
      const nonce = Math.random().toString(36).slice(2, 7)
      const intent = lastPhrase.value ? `The user's original request was: "${lastPhrase.value}". ` : ''
      const phrase = `${intent}Re-roll ONLY the "${ch.label}" change (currently "${ch.after}"). Propose a DIFFERENT option that still satisfies the request — not "${ch.after}". Use the same action (op "${ch.command.op}"${ch.command.target ? ` on "${ch.command.target}"` : ''}) and change nothing else. (variation ${nonce})`
      const { commands, changeRationales } = await callModel(buildAgentPrompt(describeTexture(opts.getState()), phrase))
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

  function keep() { changes.value = []; original = null; notice.value = ''; issues.value = []; review.value = null }
  function revert() { if (original) opts.setState(original); changes.value = []; original = null; notice.value = ''; issues.value = []; review.value = null }

  return { busy, error, notice, reasoning, changes, issues, review, reviewing, hasProposal, hovered, ask, acceptChange, rejectChange, reroll, keep, revert }
}
