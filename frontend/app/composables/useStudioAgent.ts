/**
 * useStudioAgent — Phase 1 "tune, everywhere". Generalizes Vibe (NL → validated
 * param patch via /api/vibe) into the unified agent UX: a per-control proposal
 * the user accepts/rejects/re-rolls, then keeps or reverts. Works for ANY studio
 * that exposes a ControlSpec list + a reactive Params object (Gradient, Shader,
 * Type, …) — reusing describeControls + validatePatch inside requestPatch.
 *
 * Tuning is single-op (set a control's value), so changes are param patches, not
 * structural commands — but they ride the same AgentBar/AgentProposal UI.
 *
 * ## Four Takes
 *
 * A studio that passes `opts.takes` gets the OTHER answer shape: instead of one
 * guess shown as a proposal list, the ask comes back as four genuinely different
 * readings, shown as a filmstrip (`TakeStrip.vue`, mounted once in
 * `StudioModalShell.vue` — so every studio wired here gets it without its own
 * template). This composable owns the session: capture the original ONCE, preview
 * a take by writing it into the live params, restore exactly on unhover/dismiss,
 * commit through the SAME `recompute()` + `keep()` path an accepted proposal
 * always used (so undo/autosave integration follows for free).
 *
 * Everything degrades: a server that rejects or ignores `variants`, or a reply
 * with fewer than two usable takes, falls back to today's single proposal.
 * A studio that passes no `opts.takes` never sends `variants` at all, and its
 * request stays byte-identical to what it sends today.
 */
import { computed, ref, shallowRef } from 'vue'
import { $fetch } from 'ofetch'
import type { ControlSpec, Params, ParamValue } from '~/lib/spacetype/effect'
import type { ProposedChange, VisualReview } from '~/composables/useLayoutAgent'
import { useVibeControl, type VibeTakesReply } from '~/composables/useVibeControl'
import { describeControls, validatePatch, type DescribedControl } from '~/lib/spacetype/controlDescriptor'
import { buildReviewPrompt, buildReviewSchema, parseReviewResponse } from '~/lib/agent/protocol'
import type { SurfaceSnapshot } from '~/lib/agent/commandSurface'
import {
  RESPREAD_AMPLIFY, SUBTLE_SUFFIX, THUMB_DIFF_MIN,
  chooseSpreadKeys, logTakeEvent, spreadAroundTake, thumbDistance, thumbSignature, pixelDistance,
  type StudioTake,
} from '~/lib/agent/takes'
import { VARIANTS_UNSUPPORTED } from '~/lib/vibePrompt'
import { takeThumbFor, type TakeThumb } from '~/lib/agent/takeThumbs'

/** How many readings to ask for. The API accepts 2–4 and rejects anything else
 *  loudly (Task 1's `optionalVariants`), so this is a constant, not a knob. */
const TAKE_COUNT = 4
const THUMB_SIZE = 160

/** What a studio must tell us to draw take thumbnails: which adapter to use, its
 *  config root, and how to view a COPY of that config as Params. The copy is why
 *  `paramsOf` exists — a thumbnail must never be drawn by mutating the config the
 *  user is looking at. */
export interface StudioTakeSource {
  studio: string
  config: () => unknown
  paramsOf: (config: unknown) => Params
}

/** A cheap deep copy. Every studio config this runs against is the same JSON blob
 *  the studio persists, so JSON round-tripping is the honest tool; anything it
 *  cannot copy is handed back as-is rather than half-copied. */
function cloneConfig<T>(v: T): T {
  try { return JSON.parse(JSON.stringify(v)) as T } catch { return v }
}

/**
 * True ONLY for the 400 `/api/vibe` raises for its own `variants` field — the
 * one that means "this server won't answer in takes". A bare 400 is not enough:
 * the route forwards Anthropic's status verbatim, so a real bad-request from the
 * model call arrives as a 400 too, and silently degrading on that one would hide
 * the bug AND bill the user for a second metered call it can never fix.
 */
function isVariantsUnsupported(e: unknown): boolean {
  const err = e as {
    statusCode?: number; status?: number; statusMessage?: string
    response?: { status?: number }
    data?: { statusMessage?: string; data?: { code?: string } }
  } | null
  const status = err?.statusCode ?? err?.status ?? err?.response?.status
  if (status !== 400) return false
  // `data.code` is the load-bearing one: it is the response BODY the route
  // wrote, so it survives every transport. The two `statusMessage` spellings
  // are ofetch's alias for the HTTP reason phrase, which is a courtesy — HTTP/2
  // has no reason phrase at all, and proxies rewrite it — so they are accepted
  // as a bonus, never relied on.
  return err?.data?.data?.code === VARIANTS_UNSUPPORTED
    || err?.data?.statusMessage === VARIANTS_UNSUPPORTED
    || err?.statusMessage === VARIANTS_UNSUPPORTED
}

/** opts.render returns a PNG data URL of the current studio canvas (enables the
 *  visual self-review pass); opts.apiKey is the Anthropic key for that pass. Both
 *  optional — omit them and the agent is tune-only (no review). */
export function useStudioAgent(opts: { controls: () => ControlSpec[]; params: Params; label: () => string; render?: () => string | null | Promise<string | null>; apiKey?: () => string; tier?: string; guidance?: () => string; takes?: StudioTakeSource }) {
  const { requestPatch, requestTakes } = useVibeControl()
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

  // ── Four Takes session ─────────────────────────────────────────────────────
  // shallowRef throughout: the strip keys its thumbnails by the take OBJECT, and
  // a deep ref would hand the component reactive proxies that no longer match
  // the raw keys in that map.
  const takes = shallowRef<StudioTake[]>([])
  const takeThumbs = shallowRef<Map<StudioTake, TakeThumb>>(new Map())
  const takeCurrentThumb = shallowRef<TakeThumb>(null)
  const selectedTake = shallowRef<StudioTake | null>(null)
  const takeDescribed = shallowRef<DescribedControl[]>([])
  /** Every described control's value at the moment the strip opened — the frame
   *  of reference the neighbour spread measures against. Must NOT be re-read
   *  from live params, which carry whatever take is currently previewing. */
  const takeBase = shallowRef<Record<string, ParamValue>>({})
  /** The ONE capture: the prior value of every key any take touches. Restoring
   *  writes these back verbatim, `undefined` included, so a key the config never
   *  had does not survive a preview. */
  let takeOriginal: Record<string, ParamValue> | null = null
  let takeRound = 0
  /** Set only while the strip is showing a parametric SPREAD (not model takes):
   *  the take it spread around, its thumbnail, and the seed — everything the
   *  render-aware re-spread below needs. Cleared for a model round, which has
   *  nothing to be "too close to". */
  let spreadRef: { take: StudioTake, thumb: TakeThumb, seed: string } | null = null

  const hasTakes = computed(() => takes.value.length > 0)
  /** "≈ variations of this" is honest only when the pick actually moved a dial:
   *  spreading unrelated sliders around a colour-only take would be four
   *  neighbours of something the user never asked about. */
  const canVaryTake = computed(() => {
    const t = selectedTake.value
    if (!t) return false
    return chooseSpreadKeys(takeDescribed.value, takeBase.value, t).length > 0
  })

  function applyTake(t: StudioTake) {
    for (const ch of t.changes) opts.params[ch.key] = ch.value
  }

  function restoreTakeOriginal() {
    if (!takeOriginal) return
    for (const k of Object.keys(takeOriginal)) opts.params[k] = takeOriginal[k] as ParamValue
  }

  function resetTakes() {
    takes.value = []
    takeThumbs.value = new Map()
    takeCurrentThumb.value = null
    selectedTake.value = null
    takeDescribed.value = []
    takeBase.value = {}
    takeOriginal = null
    spreadRef = null
  }

  function logTake(action: 'keep' | 'dismiss' | 'switch', t: StudioTake | null) {
    if (!opts.takes) return
    // How different this take LOOKED from the current design. Free to collect
    // and the only way THUMB_DIFF_MIN ever stops being a guess.
    const visualDiff = t ? thumbDistance(takeThumbs.value.get(t), takeCurrentThumb.value) : null
    logTakeEvent({
      studio: opts.takes.studio,
      prompt: lastPhrase.value,
      takeLabel: t?.label ?? 'yours',
      changes: t?.changes ?? [],
      action,
      ...(visualDiff === null ? {} : { visualDiff: Number(visualDiff.toFixed(2)) }),
    })
  }

  /**
   * Draw every tile. Fire-and-forget on purpose — the strip is already on screen
   * with pending tiles, and each thumbnail replaces one as it lands. The base
   * config is copied ONCE, synchronously, before the first await: the user can
   * hover (and so mutate the live config) while these are still rendering.
   */
  async function renderTakeThumbs(list: StudioTake[]) {
    const src = opts.takes
    if (!src) return
    const adapter = takeThumbFor(src.studio)
    const baseSnapshot = cloneConfig(src.config())
    const draw = async (t: StudioTake) => {
      const snapshot = cloneConfig(baseSnapshot)
      const p = src.paramsOf(snapshot)
      for (const ch of t.changes) p[ch.key] = ch.value
      return adapter(snapshot, THUMB_SIZE)
    }
    if (!takeCurrentThumb.value) {
      const yours = await adapter(cloneConfig(baseSnapshot), THUMB_SIZE)
      if (takes.value === list) takeCurrentThumb.value = yours
    }
    for (const t of list) {
      const thumb = await draw(t)
      if (takes.value !== list) return // superseded by a re-roll or a dismiss
      takeThumbs.value = new Map(takeThumbs.value).set(t, thumb)
    }
    if (spreadRef) await tightenAgainstPick(list, draw)
  }

  /**
   * The honest half of "≈ variations": the four configs being provably
   * different is not the promise — the four PICTURES being different is.
   *
   * With the tiles drawn, each is pixel-compared against the take it spread
   * around. One that reads as the same picture gets ONE re-spread at
   * RESPREAD_AMPLIFY the amplitude with a different rotation seed; if the wider
   * one still reads the same, it is kept (it moved further, so it is the better
   * of the two) with `(subtle)` appended — saying so beats four tiles that
   * quietly claim to be alternatives.
   *
   * A pair that cannot be measured (a data-URL thumb, no canvas, a render that
   * failed) is left alone — `null` means "can't tell", never "identical".
   */
  async function tightenAgainstPick(list: StudioTake[], draw: (t: StudioTake) => Promise<TakeThumb>) {
    const ref = spreadRef
    if (!ref) return
    const refSig = thumbSignature(ref.thumb)
    if (!refSig) return
    let current = list
    for (let i = 0; i < current.length; i++) {
      const t = current[i]!
      const d = pixelDistance(thumbSignature(takeThumbs.value.get(t)), refSig)
      if (d === null || d >= THUMB_DIFF_MIN) continue
      const wider = spreadAroundTake(
        takeDescribed.value, takeBase.value, ref.take, `${ref.seed}~wider`,
        { amplitudeScale: RESPREAD_AMPLIFY },
      )[i]
      if (!wider) continue
      const thumb = await draw(wider)
      if (takes.value !== current) return // superseded while we were drawing
      const d2 = pixelDistance(thumbSignature(thumb), refSig)
      const kept = (d2 !== null && d2 < THUMB_DIFF_MIN)
        ? { ...wider, label: `${wider.label}${SUBTLE_SUFFIX}` }
        : wider
      const nextList = current.slice()
      nextList[i] = kept
      const nextThumbs = new Map(takeThumbs.value)
      nextThumbs.delete(t)
      nextThumbs.set(kept, thumb)
      current = nextList
      takes.value = nextList
      takeThumbs.value = nextThumbs
      if (selectedTake.value === t) selectedTake.value = kept
    }
  }

  /** Show a list of takes. The live config MUST equal the original when this is
   *  called — that is what makes the capture below the real prior value. */
  function setTakes(list: StudioTake[]) {
    takeOriginal ??= {}
    for (const t of list) {
      for (const ch of t.changes) {
        if (!(ch.key in takeOriginal!)) takeOriginal![ch.key] = opts.params[ch.key] as ParamValue
      }
    }
    takes.value = list
    takeThumbs.value = new Map()
    selectedTake.value = null
    void renderTakeThumbs(list)
  }

  function openTakes(reply: VibeTakesReply) {
    takeDescribed.value = reply.described
    takeBase.value = Object.fromEntries(
      reply.described.map(d => [d.path, (opts.params[d.path] ?? d.current) as ParamValue]),
    )
    takeOriginal = {}
    takeCurrentThumb.value = null
    spreadRef = null
    setTakes(reply.takes)
  }

  /** Hover: show `t`, or fall back to whatever is SELECTED (a selection is live,
   *  so leaving the row must not undo it) and only then to the original. */
  function previewTake(t: StudioTake | null) {
    restoreTakeOriginal()
    const show = t ?? selectedTake.value
    if (show) applyTake(show)
  }

  /** Click a tile, or "yours" (null) to reselect the original. */
  function selectTake(t: StudioTake | null) {
    selectedTake.value = t
    restoreTakeOriginal()
    if (t) applyTake(t)
    logTake('switch', t)
  }

  /**
   * Commit the pick. Deliberately NOT "the values are already live, just clear
   * the strip": the take is put back to the original and then written through
   * `recompute()` — the exact writer an accepted proposal used — and committed
   * with the existing `keep()`. Anything hanging off that path (undo, autosave,
   * the studio's own watchers) therefore sees a keep identical to today's.
   */
  function keepTake() {
    const t = selectedTake.value
    if (!t) return
    restoreTakeOriginal()
    clearOriginal()
    const built: ProposedChange[] = []
    for (const ch of t.changes) {
      if (ch.value === opts.params[ch.key]) continue // skip no-ops, same as ask()
      original[ch.key] = opts.params[ch.key] as ParamValue
      built.push(changeFor(ch.key, ch.value, t.rationale))
    }
    changes.value = built
    recompute()
    logTake('keep', t)
    resetTakes()
    keep()
  }

  function dismissTakes() {
    if (!hasTakes.value) return
    restoreTakeOriginal()
    logTake('dismiss', selectedTake.value)
    resetTakes()
  }

  /** Abandoning an open strip — by retyping, or by closing the studio — must
   *  behave exactly like dismissing it. Anything less turns a hovered take into
   *  the new baseline, which is unrecoverable (the original is gone) and
   *  unrecorded (the pick log never sees the rejection). */
  function abandonTakes() {
    if (hasTakes.value) dismissTakes()
  }

  /** "≈ variations of this" — four parametric neighbours, computed here. No
   *  model call, and none of the honesty problems a fake one would have. */
  function variationsOfTake(t: StudioTake) {
    if (busy.value || !opts.takes) return
    if (!chooseSpreadKeys(takeDescribed.value, takeBase.value, t).length) return
    const seed = `${lastPhrase.value}#${++takeRound}`
    const next = spreadAroundTake(takeDescribed.value, takeBase.value, t, seed)
    if (!next.length) return
    restoreTakeOriginal()
    // Captured BEFORE setTakes clears the thumb map — this is what the four new
    // tiles have to look different FROM.
    spreadRef = { take: t, thumb: takeThumbs.value.get(t) ?? null, seed }
    setTakes(next)
  }

  /** "↻ different directions" — a fresh ask, pushed away from what came back
   *  last time by naming those labels. */
  async function moreDirections() {
    if (busy.value || !opts.takes || !lastPhrase.value) return
    restoreTakeOriginal()
    // Drop the selection with the preview it was showing: if the re-roll fails
    // the old strip stays up, and a tile still ringed as "selected" over an
    // unapplied config would be lying about what the studio is showing.
    selectedTake.value = null
    busy.value = true; error.value = ''
    try {
      const avoid = takes.value.map(t => t.label).join(', ')
      const phrase = `${lastPhrase.value} — give ${TAKE_COUNT} DIFFERENT directions${avoid ? `, none of them a restatement of: ${avoid}` : ''}. (round ${++takeRound})`
      const reply = await requestTakes(opts.controls(), opts.params, opts.label(), phrase, opts.guidance?.(), TAKE_COUNT)
      if (reply.takes.length >= 2) openTakes(reply)
      else notice.value = 'No different directions came back — try rewording it.'
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  /** Visual self-review: render the result, let a multimodal model critique it,
   *  surface findings + append setParam fixes as fromReview changes. Best-effort. */
  async function runVisualReview(intent: string) {
    if (!opts.render || !opts.apiKey) return
    reviewing.value = true
    try {
      const image = await opts.render()
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

  /** Today's answer shape: one patch, shown as an accept/reject proposal. */
  function showProposal(patch: Record<string, ParamValue>, rationale: string, phrase: string) {
    const built: ProposedChange[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (value === opts.params[key]) continue // skip no-ops
      original[key] = opts.params[key] as ParamValue
      built.push(changeFor(key, value, rationale))
    }
    changes.value = built
    if (!built.length) notice.value = rationale || 'No changes for that request.'
    recompute()
    if (built.length) void runVisualReview(phrase) // fire-and-forget: proposal shows now, review catches up
  }

  async function ask(phrase: string) {
    const p = phrase.trim()
    if (!p || busy.value) return
    // BEFORE lastPhrase moves: an open strip is being abandoned, and it is the
    // OLD phrase that rejection belongs to.
    abandonTakes()
    busy.value = true; error.value = ''; notice.value = ''; review.value = null; lastPhrase.value = p
    clearOriginal()
    resetTakes()
    try {
      if (opts.takes) {
        let reply: VibeTakesReply | null = null
        try {
          reply = await requestTakes(opts.controls(), opts.params, opts.label(), p, opts.guidance?.(), TAKE_COUNT)
        } catch (e) {
          // Only this server's own "I don't do takes" 400 is re-asked the
          // single-patch way; every other failure is the user's to see.
          if (!isVariantsUnsupported(e)) throw e
        }
        if (reply && reply.takes.length >= 2) { openTakes(reply); return }
        if (reply) {
          // One usable take, or the old single-patch shape: either way the answer
          // is already paid for — show it as today's proposal.
          const only = reply.takes[0]
          const patch = reply.patch ?? Object.fromEntries((only?.changes ?? []).map(c => [c.key, c.value]))
          showProposal(patch, reply.rationale ?? only?.rationale ?? '', p)
          return
        }
      }
      const { patch, rationale } = await requestPatch(opts.controls(), opts.params, opts.label(), p, opts.guidance?.())
      showProposal(patch, rationale, p)
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

  return {
    busy, error, notice, review, reviewing, changes, hasProposal, hovered, ask, acceptChange, rejectChange, reroll, keep, revert,
    // Four Takes
    takes, takeThumbs, takeCurrentThumb, selectedTake, hasTakes, canVaryTake,
    previewTake, selectTake, keepTake, dismissTakes, abandonTakes, moreDirections, variationsOfTake,
  }
}
