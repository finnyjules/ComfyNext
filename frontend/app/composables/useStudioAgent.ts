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
  DIFFERS_SUFFIX, PARTIAL_SUFFIX, RESPREAD_AMPLIFY, SUBTLE_SUFFIX, THUMB_DIFF_MIN, withSuffix,
  checkPromise, chooseSpreadKeys, logTakeEvent, spreadAroundTake, thumbDistance, thumbSignature, pixelDistance,
  type PromiseCheck, type StudioTake,
} from '~/lib/agent/takes'
import { VARIANTS_UNSUPPORTED, type PromiseDirection } from '~/lib/vibePrompt'
import { takeThumbFor, type TakeThumb } from '~/lib/agent/takeThumbs'

/** How many readings to ask for. The API accepts 2–4 and rejects anything else
 *  loudly (Task 1's `optionalVariants`), so this is a constant, not a knob. */
const TAKE_COUNT = 4
const THUMB_SIZE = 160

/**
 * A control that swaps the studio's WHOLE base config rather than nudging one
 * value — Gradient's `preset`. Generic on purpose: Shader's `effect` is the same
 * shape (and the same hazard) and can ride this hook when its takes land.
 *
 * Two halves, both required, mirroring `studioTune`'s macro-ordering contract:
 * the macro applies FIRST, and the take's remaining changes are then validated
 * against the SWAPPED config's vocabulary — a preset can change how many colour
 * stops exist, so a stop-colour written against the old list would be dropped
 * (or, worse, land on a stop that means something else).
 */
export interface StudioTakeMacro {
  /** The control key that carries the swap (Gradient: `preset`). */
  key: string
  /** Build the base config for a macro value, or null for an unknown one. */
  apply: (value: string, config: unknown) => unknown | null
  /** The vocabulary of a config AFTER the swap. */
  recontrol: (config: unknown) => ControlSpec[]
}

/**
 * The one repair a promise check is allowed to make.
 *
 * Deliberately narrow. A direction is the only claim with an unambiguous local
 * correction — "the user asked for top-to-bottom and got side-to-side" has one
 * obvious answer, and it is a value the model already implied. A colour or a
 * tone does not: picking one would be choosing something nobody asked for and
 * calling it the model's idea.
 */
export interface StudioTakeRepair {
  /** Candidate writes for a promised direction. Validated against the take's
   *  post-macro vocabulary before anything is applied, so a key this studio does
   *  not offer is dropped rather than invented; return `{}` for a direction this
   *  studio cannot aim. */
  directionPatch: (direction: PromiseDirection, config: unknown) => Record<string, ParamValue>
}

/** What a studio must tell us to draw take thumbnails: which adapter to use, its
 *  config root, and how to view a COPY of that config as Params. The copy is why
 *  `paramsOf` exists — a thumbnail must never be drawn by mutating the config the
 *  user is looking at. */
export interface StudioTakeSource {
  studio: string
  config: () => unknown
  paramsOf: (config: unknown) => Params
  /** Vocabulary for the TAKES ask. Defaults to the tune vocabulary — Gradient
   *  overrides it to add the `preset` macro, which the single-tune path
   *  deliberately still withholds. */
  controls?: () => ControlSpec[]
  /** Guidance for the TAKES ask. MUST match whatever `controls` offers: guidance
   *  naming a key the list lacks is the failure this whole seam exists to stop. */
  guidance?: () => string
  /** Replace the whole base config. Required when `macro` is set — a macro
   *  cannot be expressed through the leaf-writing Params proxy. */
  setConfig?: (config: unknown) => void
  /** Studio-owned view state a macro swap is allowed to disturb — Gradient's
   *  selected layer, which `setConfig` must clamp when a preset arrives with
   *  fewer layers. Captured when the strip opens and put back with the config,
   *  so one hover cannot permanently move the user's selection. */
  captureView?: () => unknown
  restoreView?: (view: unknown) => void
  macro?: StudioTakeMacro
  /** How to re-aim this studio's picture when a take's promised DIRECTION did
   *  not come out. Omit it and a direction miss is labelled instead of fixed —
   *  which is the right answer for a studio with no key that aims anything. */
  repair?: StudioTakeRepair
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

  /** The vocabulary and guidance the TAKES ask uses. A studio may widen both —
   *  Gradient adds the `preset` macro here and nowhere else, because a take is
   *  previewed non-destructively and only committed on an explicit Keep, whereas
   *  the single-tune path would apply a whole-config swap the instant it landed.
   *  They move together on purpose: guidance that names a key its own list lacks
   *  is the exact failure this pair exists to prevent. */
  function takeControls(): ControlSpec[] { return opts.takes?.controls?.() ?? opts.controls() }
  function takeGuidance(): string | undefined { return opts.takes?.guidance?.() ?? opts.guidance?.() }

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
  /** A deep copy of the base config as the strip opened — the only way back from
   *  a macro swap. Null for a studio with no macro. */
  let takeOriginalConfig: unknown = null
  /** The studio's own view state at that same moment (Gradient's active layer). */
  let takeOriginalView: unknown = null
  /**
   * One materialized base config per macro VALUE, for the life of the strip.
   *
   * `buildGradientPreset` re-seeds itself on every call — noise seed, flow angle,
   * light azimuth. Calling it once per consumer would mean the tile you looked
   * at, the preview you hovered, and the config you kept were three different
   * gradients, and a second hover would visibly re-roll. So a macro value is
   * built ONCE and every consumer works from a copy of that instance.
   */
  const macroConfigs = new Map<string, unknown>()

  /** The one materialization of `value`, or null if the studio rejects it. */
  function materializeMacro(value: string): unknown | null {
    const src = opts.takes
    const macro = src?.macro
    if (!macro || !src) return null
    if (macroConfigs.has(value)) return macroConfigs.get(value)!
    const built = macro.apply(value, src.config())
    if (built) macroConfigs.set(value, built)
    return built ?? null
  }
  let takeRound = 0
  /** Set only while the strip is showing a parametric SPREAD (not model takes):
   *  the take it spread around, its thumbnail, and the seed — everything the
   *  render-aware re-spread below needs. Cleared for a model round, which has
   *  nothing to be "too close to". */
  let spreadRef: { take: StudioTake, thumb: TakeThumb, seed: string } | null = null

  /** Keys a take asked for that nothing could apply — per take, for the log and
   *  for the `(partial)` caption. */
  const takeDropped = shallowRef<Map<StudioTake, string[]>>(new Map())
  /** How each take's promise measured against its real render. */
  const takePromiseResults = shallowRef<Map<StudioTake, PromiseCheck[]>>(new Map())

  const hasTakes = computed(() => takes.value.length > 0)
  /** "≈ variations of this" is honest only when the pick actually moved a dial:
   *  spreading unrelated sliders around a colour-only take would be four
   *  neighbours of something the user never asked about. */
  const canVaryTake = computed(() => {
    const t = selectedTake.value
    if (!t) return false
    return chooseSpreadKeys(takeDescribed.value, takeBase.value, t).length > 0
  })

  /**
   * Turn ONE raw model take into the take the rest of the system handles:
   * macro first (it decides which keys even exist), everything else validated
   * against the resulting vocabulary, and an honest count of what was lost.
   *
   * Returns null for a take with nothing applicable left — that take IS the
   * current config, and showing it as an alternative would be a lie.
   */
  function finalizeTake(rawTake: StudioTake, described: DescribedControl[]): { take: StudioTake, dropped: string[] } | null {
    const src = opts.takes
    const macro = src?.macro
    const raw: Record<string, ParamValue> = {}
    for (const ch of rawTake.changes) raw[ch.key] = ch.value

    let vocabulary = described
    let macroChange: { key: string, value: ParamValue } | null = null
    const macroValue = macro ? raw[macro.key] : undefined
    if (macro && src && typeof macroValue === 'string') {
      const swapped = materializeMacro(macroValue)
      if (swapped) {
        macroChange = { key: macro.key, value: macroValue }
        // Re-describe against the SWAPPED config: a preset can change how many
        // colour stops exist, and a stop colour validated against the old list
        // would be dropped or land on a stop that now means something else.
        vocabulary = describeControls(macro.recontrol(swapped), src.paramsOf(swapped))
      }
    }

    const rest: Record<string, ParamValue> = {}
    for (const [k, v] of Object.entries(raw)) { if (k !== macro?.key) rest[k] = v }
    const valid = validatePatch(rest, vocabulary)
    const changes = Object.entries(valid).map(([key, value]) => ({ key, value }))
    const dropped = Object.keys(rest).filter(k => !(k in valid))
    // A macro value the studio did not recognise is a dropped key like any other.
    if (macro && macroValue !== undefined && !macroChange) dropped.push(macro.key)
    if (macroChange) changes.unshift(macroChange) // macro FIRST — every consumer applies in order
    if (!changes.length) return null

    // More than half the ask lost? Say so on the tile, the same way `(subtle)`
    // does — silent dropping is what let a sunset rationale sit over a rainbow.
    const asked = Object.keys(raw).length
    const label = dropped.length * 2 > asked ? withSuffix(rawTake.label, PARTIAL_SUFFIX) : rawTake.label
    return {
      take: { label, changes, rationale: rawTake.rationale, ...(rawTake.promise ? { promise: rawTake.promise } : {}) },
      dropped,
    }
  }

  /**
   * The ONE place a take's changes become writes. The macro (if any) is at the
   * head of `changes`, so a single ordered pass gives the required
   * macro-then-overrides sequence; `swapBase` is handed the macro VALUE and
   * returns the Params view of whatever base it installed.
   */
  function applyTakeWith(t: StudioTake, params: Params, swapBase: (value: string) => Params | null): void {
    const macro = opts.takes?.macro
    let write = params
    for (const ch of t.changes) {
      if (macro && ch.key === macro.key) {
        const next = swapBase(String(ch.value))
        if (next) write = next
        continue
      }
      write[ch.key] = ch.value
    }
  }

  /** Install a macro's base config on the LIVE studio. Returns null because the
   *  live Params proxy reads through to whatever `setConfig` installed — there is
   *  no second view to hand back. */
  function swapLiveBase(value: string): Params | null {
    const src = opts.takes
    if (!src?.setConfig) return null
    const swapped = materializeMacro(value)
    // A COPY: the materialization is the shared source of truth for this macro
    // value, and the live config is about to be edited by the take's overrides.
    if (swapped) src.setConfig(cloneConfig(swapped))
    return null
  }

  /** Apply a take to the LIVE studio. */
  function applyTake(t: StudioTake) {
    applyTakeWith(t, opts.params, swapLiveBase)
  }

  /**
   * Undo whatever a preview applied. Two mechanisms, because a macro cannot be
   * undone key-by-key: it replaced the whole base config, so the whole base
   * config is what has to come back. A studio without a macro keeps the
   * (cheaper, byte-exact) per-key restore it always had.
   */
  function restoreTakeOriginal() {
    const src = opts.takes
    if (src?.macro && src.setConfig && takeOriginalConfig !== null) {
      src.setConfig(cloneConfig(takeOriginalConfig))
      // The view goes back BEFORE anything else reads it — `setConfig` clamps a
      // selection that a fewer-layer preset made invalid, and leaving it clamped
      // means one hover permanently moved the user's selected layer.
      if (src.restoreView) src.restoreView(takeOriginalView)
      // …and then STOP. The whole config is already back. Replaying the captured
      // keys on top would re-resolve every `layer.` path against whatever index
      // is current now — writing one layer's values into another, which the deep
      // watcher then saves. A hover must not be able to corrupt a document.
      return
    }
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
    takeOriginalConfig = null
    takeOriginalView = null
    macroConfigs.clear()
    takeDropped.value = new Map()
    takePromiseResults.value = new Map()
    spreadRef = null
  }

  function logTake(action: 'keep' | 'dismiss' | 'switch', t: StudioTake | null) {
    if (!opts.takes) return
    // How different this take LOOKED from the current design. Free to collect
    // and the only way THUMB_DIFF_MIN ever stops being a guess.
    const visualDiff = t ? thumbDistance(takeThumbs.value.get(t), takeCurrentThumb.value) : null
    // …and, for a spread tile, the distance the GUARD actually gates on. Logging
    // only the vs-yours number would calibrate a threshold nothing measures.
    const fromPick = t && spreadRef ? thumbDistance(takeThumbs.value.get(t), spreadRef.thumb) : null
    logTakeEvent({
      studio: opts.takes.studio,
      prompt: lastPhrase.value,
      takeLabel: t?.label ?? 'yours',
      changes: t?.changes ?? [],
      action,
      ...(visualDiff === null ? {} : { visualDiff: Number(visualDiff.toFixed(2)) }),
      ...(fromPick === null ? {} : { visualDiffFromPick: Number(fromPick.toFixed(2)) }),
      ...(t && takeDropped.value.get(t)?.length ? { droppedKeys: takeDropped.value.get(t)! } : {}),
      ...(t && takePromiseResults.value.get(t)?.length ? { promiseResults: takePromiseResults.value.get(t)! } : {}),
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
      // A macro take is drawn from the config the macro produces, not from a
      // copy of the user's — otherwise a preset tile shows the old base look
      // with a couple of colours moved, which is precisely the lie that was
      // shipped.
      let snapshot = cloneConfig(baseSnapshot)
      applyTakeWith(t, src.paramsOf(snapshot), (value) => {
        const swapped = materializeMacro(value)
        if (!swapped) return null
        // The same instance every consumer sees, copied so the overrides below
        // cannot leak back into it.
        snapshot = cloneConfig(swapped)
        return src.paramsOf(snapshot)
      })
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
    await verifyPromises(list, draw)
  }

  /** The vocabulary a take's non-macro changes were (and must be) validated
   *  against — the swapped config's when the take carries a macro. */
  function vocabularyFor(t: StudioTake): DescribedControl[] {
    const src = opts.takes
    const macro = src?.macro
    const value = macro ? t.changes.find(c => c.key === macro.key)?.value : undefined
    if (macro && src && typeof value === 'string') {
      const swapped = materializeMacro(value)
      if (swapped) return describeControls(macro.recontrol(swapped), src.paramsOf(swapped))
    }
    return takeDescribed.value
  }

  /**
   * Check what each take PROMISED against what it actually rendered — the
   * general safety net over the whole intent chain. The model can be wrong, the
   * vocabulary can be missing a key, a preset can be mis-aimed, a renderer can
   * surprise us; all of those end as a picture that does not match the claim,
   * and this is the one place that notices without needing to know which.
   *
   * Three outcomes, in order of preference:
   *   1. the claim holds — say nothing;
   *   2. a DIRECTION claim broke and this studio offers something to aim with —
   *      one local repair, kept only if the check then passes;
   *   3. anything still broken — label the tile, warn with what was measured,
   *      and record it. Never a second model call, and never a repair for a
   *      colour or a tone: choosing one would be inventing an intent.
   *
   * A take with no promise, or one whose render failed, is skipped entirely.
   * Missing evidence is not a broken promise.
   */
  async function verifyPromises(list: StudioTake[], draw: (t: StudioTake) => Promise<TakeThumb>) {
    const src = opts.takes
    if (!src) return
    let current = list

    const commit = (i: number, next: StudioTake, thumb: TakeThumb) => {
      const old = current[i]!
      const nextList = current.slice()
      nextList[i] = next
      const nextThumbs = new Map(takeThumbs.value)
      nextThumbs.delete(old)
      nextThumbs.set(next, thumb)
      const nextResults = new Map(takePromiseResults.value)
      const carried = nextResults.get(old)
      nextResults.delete(old)
      if (carried) nextResults.set(next, carried)
      const nextDropped = new Map(takeDropped.value)
      const lost = nextDropped.get(old)
      nextDropped.delete(old)
      if (lost) nextDropped.set(next, lost)
      current = nextList
      takes.value = nextList
      takeThumbs.value = nextThumbs
      takePromiseResults.value = nextResults
      takeDropped.value = nextDropped
      if (selectedTake.value === old) selectedTake.value = next
    }

    for (let i = 0; i < current.length; i++) {
      let take = current[i]!
      const promise = take.promise
      if (!promise) continue
      let results = checkPromise(thumbSignature(takeThumbs.value.get(take)), promise)
      if (!results.length) continue // nothing measurable — not a miss

      // ── one local repair, for direction only ────────────────────────────
      const missedDirection = results.some(r => r.claim === 'direction' && !r.ok)
      if (missedDirection && promise.direction && src.repair) {
        const patch = validatePatch(
          src.repair.directionPatch(promise.direction, src.config()),
          vocabularyFor(take),
        )
        const entries = Object.entries(patch)
        if (entries.length) {
          const changes = take.changes.filter(c => !(c.key in patch))
            .concat(entries.map(([key, value]) => ({ key, value })))
          const candidate: StudioTake = { ...take, changes }
          const thumb = await draw(candidate)
          if (takes.value !== current) return // superseded while we were drawing
          const after = checkPromise(thumbSignature(thumb), promise)
          if (after.every(r => r.claim !== 'direction' || r.ok)) {
            // Kept — and only now, so a repair that did not work leaves no trace.
            commit(i, candidate, thumb)
            take = candidate
            results = after
          }
        }
      }

      const failed = results.filter(r => !r.ok)
      takePromiseResults.value = new Map(takePromiseResults.value).set(take, results)
      if (!failed.length) continue

      for (const r of failed) {
        console.warn(`[takes] "${take.label}" promised ${r.claim} ${JSON.stringify((promise as Record<string, unknown>)[r.claim])} — the render is ${r.measured}`)
      }
      // ONE suffix. `(partial)` already says the stronger thing about a take
      // that lost half its changes, so `(differs)` does not pile on.
      if (!take.label.includes(PARTIAL_SUFFIX.trim())) {
        commit(i, { ...take, label: withSuffix(take.label, DIFFERS_SUFFIX) }, takeThumbs.value.get(take) ?? null)
      }
    }
  }

  /**
   * The honest half of "≈ variations": the four configs being provably
   * different is not the promise — the four PICTURES being different is.
   *
   * Two passes, because there are two ways to disappoint. First each tile is
   * compared with the take it spread AROUND (a variation indistinguishable from
   * its own parent is not a variation). Then the four are compared with EACH
   * OTHER — which is what the owner actually complained about, and what a
   * vs-parent check alone can miss: four tiles can each sit far from the parent
   * and still be crowded together.
   *
   * Either way the remedy is the same and is bounded: ONE re-spread of that slot
   * at RESPREAD_AMPLIFY the amplitude with a different rotation seed. A slot that
   * has already had its retry, and is still too close, is kept (it moved further,
   * so it is the better of the two) with `(subtle)` appended and then left alone —
   * saying so beats four tiles that quietly claim to be alternatives, and it is
   * what stops the pairwise pass chasing a pair it cannot separate.
   *
   * A pair that cannot be measured (a data-URL thumb, no canvas, a render that
   * failed) is left alone — `null` means "can't tell", never "identical", so it
   * never triggers a re-spread and never stamps `(subtle)`.
   */
  async function tightenAgainstPick(list: StudioTake[], draw: (t: StudioTake) => Promise<TakeThumb>) {
    const ref = spreadRef
    if (!ref) return
    const { take: refTake, seed: refSeed, thumb: refThumb } = ref
    let current = list
    /** Slots that have used their one re-spread. */
    const retried = new Set<number>()
    /** Slots already labelled `(subtle)` — the pairwise pass must stop picking
     *  them, or it would loop on a pair no amplitude can separate. */
    const conceded = new Set<number>()

    const sigOf = (i: number) => thumbSignature(takeThumbs.value.get(current[i]!))

    function commitSlot(i: number, next: StudioTake, thumb: TakeThumb) {
      const old = current[i]!
      const nextList = current.slice()
      nextList[i] = next
      const nextThumbs = new Map(takeThumbs.value)
      nextThumbs.delete(old)
      nextThumbs.set(next, thumb)
      current = nextList
      takes.value = nextList
      takeThumbs.value = nextThumbs
      if (selectedTake.value === old) selectedTake.value = next
    }

    /** Redraw slot `i` from a wider spread. False ⇒ superseded, stop entirely. */
    async function widen(i: number): Promise<boolean> {
      const wider = spreadAroundTake(
        takeDescribed.value, takeBase.value, refTake, `${refSeed}~wider`,
        { amplitudeScale: RESPREAD_AMPLIFY },
      )[i]
      retried.add(i)
      if (!wider) return true
      const thumb = await draw(wider)
      if (takes.value !== current) return false
      commitSlot(i, wider, thumb)
      return true
    }

    function concede(i: number) {
      conceded.add(i)
      const t = current[i]!
      if (t.label.endsWith(SUBTLE_SUFFIX)) return
      commitSlot(i, { ...t, label: withSuffix(t.label, SUBTLE_SUFFIX) }, takeThumbs.value.get(t) ?? null)
    }

    // ① each tile against the take it spread around
    const refSig = thumbSignature(refThumb)
    if (refSig) {
      for (let i = 0; i < current.length; i++) {
        const d = pixelDistance(sigOf(i), refSig)
        if (d === null || d >= THUMB_DIFF_MIN) continue
        if (!await widen(i)) return
        const d2 = pixelDistance(sigOf(i), refSig)
        if (d2 !== null && d2 < THUMB_DIFF_MIN) concede(i)
      }
    }

    // ② the four against each other. Each iteration takes the closest measurable
    // pair whose LATER slot is still movable, and either widens it or concedes
    // it — so every slot is touched at most twice and the loop always ends.
    const closestPair = () => {
      const sigs = current.map((_, i) => sigOf(i))
      let best: { j: number, d: number } | null = null
      for (let a = 0; a < sigs.length; a++) {
        for (let b = a + 1; b < sigs.length; b++) {
          if (conceded.has(b)) continue
          const d = pixelDistance(sigs[a]!, sigs[b]!)
          if (d === null || d >= THUMB_DIFF_MIN) continue
          if (!best || d < best.d) best = { j: b, d }
        }
      }
      return best
    }
    for (let guard = 0; guard < current.length * 2; guard++) {
      const pair = closestPair()
      if (!pair) break
      if (retried.has(pair.j)) { concede(pair.j); continue }
      if (!await widen(pair.j)) return
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

  /** Validate a whole reply into showable takes, recording what each one lost. */
  function finalizeTakes(reply: VibeTakesReply): { takes: StudioTake[], dropped: Map<StudioTake, string[]> } {
    const out: StudioTake[] = []
    const dropped = new Map<StudioTake, string[]>()
    for (const raw of reply.takes) {
      const done = finalizeTake(raw, reply.described)
      if (!done) continue
      out.push(done.take)
      if (done.dropped.length) dropped.set(done.take, done.dropped)
    }
    const lost = [...dropped.values()].flat()
    if (lost.length) {
      // Third time this class has bitten. It is no longer allowed to be silent.
      console.warn(
        `[takes] ${lost.length} requested key(s) could not be applied and were dropped:`,
        [...new Set(lost)].join(', '),
      )
    }
    return { takes: out, dropped }
  }

  function openTakes(reply: VibeTakesReply, finalized: { takes: StudioTake[], dropped: Map<StudioTake, string[]> }) {
    takeDescribed.value = reply.described
    takeBase.value = Object.fromEntries(
      reply.described.map(d => [d.path, (opts.params[d.path] ?? d.current) as ParamValue]),
    )
    takeOriginal = {}
    takeOriginalConfig = opts.takes?.macro ? cloneConfig(opts.takes.config()) : null
    takeOriginalView = opts.takes?.captureView?.() ?? null
    takeCurrentThumb.value = null
    takeDropped.value = finalized.dropped
    spreadRef = null
    setTakes(finalized.takes)
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
    const macro = opts.takes?.macro
    // The macro half has no older equivalent to route through — swapping the
    // base config IS its apply path, and it must land before the overrides so
    // they are measured against the config they will live in.
    if (macro) {
      const swap = t.changes.find(c => c.key === macro.key)
      if (swap) swapLiveBase(String(swap.value))
    }
    const built: ProposedChange[] = []
    for (const ch of t.changes) {
      if (macro && ch.key === macro.key) continue
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
      const reply = await requestTakes(takeControls(), opts.params, opts.label(), phrase, takeGuidance(), TAKE_COUNT)
      const finalized = finalizeTakes(reply)
      if (finalized.takes.length >= 2) openTakes(reply, finalized)
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
          reply = await requestTakes(takeControls(), opts.params, opts.label(), p, takeGuidance(), TAKE_COUNT)
        } catch (e) {
          // Only this server's own "I don't do takes" 400 is re-asked the
          // single-patch way; every other failure is the user's to see.
          if (!isVariantsUnsupported(e)) throw e
        }
        if (reply) {
          const finalized = finalizeTakes(reply)
          if (finalized.takes.length >= 2) { openTakes(reply, finalized); return }
          // One usable take, or the old single-patch shape: either way the answer
          // is already paid for — show it as today's proposal. A lone take's
          // macro cannot ride the proposal list (it is not a setParam), so it is
          // dropped here and counted like any other unapplicable key.
          const only = finalized.takes[0]
          const macroKey = opts.takes?.macro?.key
          const leaves = (only?.changes ?? []).filter(c => c.key !== macroKey)
          // A proposal list is setParam-only, so a lone take's whole-look macro
          // cannot ride it. That is a dropped key like any other and is counted
          // like one — dropping it quietly, under a rationale describing the
          // look it would have produced, IS the defect this seam exists to fix.
          const lostMacro = !!macroKey && leaves.length !== (only?.changes.length ?? 0)
          if (lostMacro) {
            console.warn(`[takes] only one usable take came back, so the whole-look change was dropped: ${macroKey}`)
          }
          const patch = reply.patch ?? Object.fromEntries(leaves.map(c => [c.key, c.value]))
          showProposal(patch, lostMacro ? '' : (reply.rationale ?? only?.rationale ?? ''), p)
          if (lostMacro) {
            notice.value = 'Only part of that could be applied: the overall style change needs the four-takes view, so just the adjustments were kept.'
          }
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
    takes, takeThumbs, takeCurrentThumb, takeDropped, takePromiseResults, selectedTake, hasTakes, canVaryTake,
    previewTake, selectTake, keepTake, dismissTakes, abandonTakes, moreDirections, variationsOfTake,
  }
}
