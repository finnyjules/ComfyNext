/**
 * useStudioAgent — Phase 1 "tune, everywhere". Generalizes Vibe (NL → validated
 * param patch via /api/vibe) into the unified agent UX: a per-control proposal
 * the user accepts/rejects/re-rolls, then keeps or reverts. Works for ANY studio
 * that exposes a ControlSpec list + a reactive Params object (Gradient, Shader,
 * Type, …) — reusing describeControls + validatePatch inside requestPatch.
 *
 * Tuning is single-op (set a control's value), so changes are param patches, not
 * structural commands — but they ride the same AgentBar/AgentProposal UI.
 */
import { computed, ref } from 'vue'
import { $fetch } from 'ofetch'
import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import type { ProposedChange, VisualReview } from '~/composables/useLayoutAgent'
import { useVibeControl } from '~/composables/useVibeControl'
import { describeControls, validatePatch } from '~/lib/spacetype/controlDescriptor'
import { buildReviewPrompt, buildReviewSchema, parseReviewResponse } from '~/lib/agent/protocol'
import type { SurfaceSnapshot } from '~/lib/agent/commandSurface'

/** opts.render returns a PNG data URL of the current studio canvas (enables the
 *  visual self-review pass); opts.apiKey is the Anthropic key for that pass. Both
 *  optional — omit them and the agent is tune-only (no review). */
export function useStudioAgent(opts: { controls: () => ControlSpec[]; params: Params; label: () => string; render?: () => string | null; apiKey?: () => string; tier?: string; guidance?: () => string }) {
  const { requestPatch } = useVibeControl()
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const lastPhrase = ref('')
  const changes = ref<ProposedChange[]>([])
  /** The visual self-review: a designer's-eye critique of the rendered result. */
  const review = ref<VisualReview | null>(null)
  const reviewing = ref(false)
  const hovered = ref<number | null>(null)
  /** Prior value of every key a change touched — for accept/reject + revert. */
  const original: Record<string, ParamValue> = {}
  const hasProposal = computed(() => changes.value.length > 0)

  function clearOriginal() { for (const k of Object.keys(original)) delete original[k] }

  /** Re-apply the accepted patches live onto the reactive params (rejected keys
   *  fall back to their original value). The studio re-renders from params. */
  function recompute() {
    for (const ch of changes.value) {
      const key = ch.command.target!
      opts.params[key] = ch.accepted ? (ch.command.args!.value as ParamValue) : (original[key] as ParamValue)
    }
  }

  function changeFor(key: string, value: ParamValue, rationale: string): ProposedChange {
    const ctrl = opts.controls().find(c => c.key === key)
    return {
      command: { op: 'setParam', target: key, args: { value } },
      label: ctrl?.label ?? key,
      before: String(opts.params[key] ?? ''),
      after: String(value),
      rationale,
      rerollable: true,
      accepted: true,
    }
  }

  /** Visual self-review: render the result, let a multimodal model critique it,
   *  surface findings + append setParam fixes as fromReview changes. Best-effort. */
  async function runVisualReview(intent: string) {
    if (!opts.render || !opts.apiKey) return
    reviewing.value = true
    try {
      const image = opts.render()
      if (!image) return
      const described = describeControls(opts.controls(), opts.params)
      const snapshot: SurfaceSnapshot = {
        surface: opts.label(),
        objects: [{ id: 'settings', label: 'Tunable settings', type: 'settings', current: { controls: described } }],
        commands: [{ op: 'setParam', hint: 'Tune one control toward a better result. target = a control key from settings; args: { value } within that control\'s range/options.' }],
      }
      const res = await $fetch<{ text: string }>('/api/agent-review', {
        method: 'POST',
        body: { apiKey: opts.apiKey(), tier: opts.tier ?? 'plan', prompt: buildReviewPrompt(snapshot, intent), schema: buildReviewSchema(snapshot.commands), image },
        timeout: 60_000,
      })
      const parsed = parseReviewResponse(res.text)
      if (parsed.parseFailed) throw new Error('The model reply could not be read — please try again.')
      const { assessment, issues: found, fixes, fixRationales } = parsed
      review.value = { assessment, issues: found }
      fixes.forEach((cmd, i) => {
        if (cmd.op !== 'setParam' || typeof cmd.target !== 'string') return
        const value = cmd.args?.value as ParamValue | undefined
        if (value === undefined) return
        const valid = validatePatch({ [cmd.target]: value }, described)
        const v = valid[cmd.target]
        if (v === undefined || v === opts.params[cmd.target]) return
        if (!(cmd.target in original)) original[cmd.target] = opts.params[cmd.target] as ParamValue
        const ch = changeFor(cmd.target, v, fixRationales[i] || 'Visual review fix')
        ch.fromReview = true
        changes.value = [...changes.value, ch]
      })
      recompute()
    } catch { /* review is best-effort */ }
    finally { reviewing.value = false }
  }

  async function ask(phrase: string) {
    const p = phrase.trim()
    if (!p || busy.value) return
    busy.value = true; error.value = ''; notice.value = ''; review.value = null; lastPhrase.value = p
    clearOriginal()
    try {
      const { patch, rationale } = await requestPatch(opts.controls(), opts.params, opts.label(), p, opts.guidance?.())
      const built: ProposedChange[] = []
      for (const [key, value] of Object.entries(patch)) {
        if (value === opts.params[key]) continue // skip no-ops
        original[key] = opts.params[key] as ParamValue
        built.push(changeFor(key, value, rationale))
      }
      changes.value = built
      if (!built.length) notice.value = rationale || 'No changes for that request.'
      recompute()
      if (built.length) void runVisualReview(p) // fire-and-forget: proposal shows now, review catches up
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
    if (!ch || busy.value) return
    busy.value = true; error.value = ''
    try {
      const key = ch.command.target!
      const ctrl = opts.controls().find(c => c.key === key)
      const nonce = Math.random().toString(36).slice(2, 7)
      const phrase = `${lastPhrase.value ? `For "${lastPhrase.value}": ` : ''}give a DISTINCTLY DIFFERENT value for "${ctrl?.label ?? key}" (currently ${ch.after}) — not ${ch.after}. Change nothing else. (variation ${nonce})`
      const { patch } = await requestPatch(opts.controls(), opts.params, opts.label(), phrase, opts.guidance?.())
      if (key in patch && patch[key] !== undefined) {
        ch.command.args!.value = patch[key]
        ch.after = String(patch[key])
        recompute()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  function keep() { changes.value = []; clearOriginal(); notice.value = ''; review.value = null } // accepted values already live
  function revert() {
    for (const [k, v] of Object.entries(original)) opts.params[k] = v
    changes.value = []; clearOriginal(); notice.value = ''; review.value = null
  }

  return { busy, error, notice, review, reviewing, changes, hasProposal, hovered, ask, acceptChange, rejectChange, reroll, keep, revert }
}
