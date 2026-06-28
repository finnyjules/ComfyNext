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
import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import type { ProposedChange } from '~/composables/useLayoutAgent'
import { useVibeControl } from '~/composables/useVibeControl'

export function useStudioAgent(opts: { controls: () => ControlSpec[]; params: Params; label: () => string }) {
  const { requestPatch } = useVibeControl()
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')
  const lastPhrase = ref('')
  const changes = ref<ProposedChange[]>([])
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

  async function ask(phrase: string) {
    const p = phrase.trim()
    if (!p || busy.value) return
    busy.value = true; error.value = ''; notice.value = ''; lastPhrase.value = p
    clearOriginal()
    try {
      const { patch, rationale } = await requestPatch(opts.controls(), opts.params, opts.label(), p)
      const built: ProposedChange[] = []
      for (const [key, value] of Object.entries(patch)) {
        if (value === opts.params[key]) continue // skip no-ops
        original[key] = opts.params[key] as ParamValue
        built.push(changeFor(key, value, rationale))
      }
      changes.value = built
      if (!built.length) notice.value = rationale || 'No changes for that request.'
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
    if (!ch || busy.value) return
    busy.value = true; error.value = ''
    try {
      const key = ch.command.target!
      const ctrl = opts.controls().find(c => c.key === key)
      const nonce = Math.random().toString(36).slice(2, 7)
      const phrase = `${lastPhrase.value ? `For "${lastPhrase.value}": ` : ''}give a DISTINCTLY DIFFERENT value for "${ctrl?.label ?? key}" (currently ${ch.after}) — not ${ch.after}. Change nothing else. (variation ${nonce})`
      const { patch } = await requestPatch(opts.controls(), opts.params, opts.label(), phrase)
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

  function keep() { changes.value = []; clearOriginal(); notice.value = '' } // accepted values already live
  function revert() {
    for (const [k, v] of Object.entries(original)) opts.params[k] = v
    changes.value = []; clearOriginal(); notice.value = ''
  }

  return { busy, error, notice, changes, hasProposal, hovered, ask, acceptChange, rejectChange, reroll, keep, revert }
}
