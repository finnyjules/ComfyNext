// useImgFx — thin Vue wrapper over img-fx's framework-agnostic core
// (createInstance / createReveal / createCycle). img-fx is Jakub Antalik's
// WebGL "image generation" effect (https://image.jakubantalik.com); we use its
// engine, not its React component (aliased away — see app/lib/imgfx/react-stub.ts).
//
// Two canvases, layered by the caller: a SHADER canvas (the churning pixel-cell
// field) and a REVEAL overlay canvas above it (where an image dissolves in/out
// cell-by-cell). The cycle is driven MANUALLY — we never call cycle.start(), so
// there is no random-image auto-loop; instead we map img-fx's phase machine onto
// a node's generate lifecycle:
//
//   churn()            → shader-only "loading" churn (phase idle)
//   boilFrom(url)      → dissolve an existing image INTO the churn (startBoil)
//   revealResult(url)  → dissolve a NEW image OUT of the churn and hold it
//   dispose()          → release the GL context (lazy: nothing is held when idle)
//
// The engine registers each instance into a shared, DPR-capped rAF loop that
// ticks at img-fx's global frame-rate cap (default 10fps — gentle by design).
import {
  createInstance, createReveal, createCycle, destroyInstance,
  updateInstanceSize, setInstanceVisible, PRESETS,
  type Instance, type RevealState, type Cycle, type CyclePhase,
  type PresetName, type PresetTheme,
} from 'img-fx'

export interface ImgFxMountOptions {
  /** Which bundled effect: 'pixels-organic' (Chromium Flow, default),
   *  'pixels-mechanic' (Nebula), 'sweep-gradient' (Gradient Sweep). */
  preset?: PresetName
  /** Palette theme. Node canvas is dark, so 'dark' by default. */
  theme?: PresetTheme
  /** Pixel-cell size multiplier (1 = preset default; <1 finer, >1 chunkier). */
  pixelScale?: number
}

const DEFAULT_PRESET: PresetName = 'pixels-organic'
// Upper bound on how long revealResult() waits for the engine's 'visible' phase
// before resolving anyway — comfortably past a normal reveal (~3s) so it only
// trips on a genuine stall.
const REVEAL_SAFETY_MS = 5000

export function useImgFx() {
  let inst: Instance | null = null
  let reveal: RevealState | null = null
  let cycle: Cycle | null = null
  let ro: ResizeObserver | null = null
  let phase: CyclePhase = 'idle'
  let disposed = false
  // Solid card surface the mosaic composites over. On the reference the mosaic
  // canvas is semi-transparent and its opaque look comes entirely from this
  // colour behind it — the caller paints it behind the shader canvas so the
  // dither reads as a full-opaque field (not a translucent wash).
  let cardBgColor = '#0f0f0f'

  // Pending-action bookkeeping so we can react to phase transitions we can't
  // trigger synchronously (the reveal loads its image on a microtask).
  let boilOnVisible = false
  let revealWaiters: Array<() => void> = []

  function flushRevealWaiters() {
    const ws = revealWaiters
    revealWaiters = []
    ws.forEach((w) => w())
  }

  function onPhase(e: { phase: CyclePhase }) {
    phase = e.phase
    if (phase === 'visible') {
      if (boilOnVisible) {
        boilOnVisible = false
        cycle?.triggerBoil()          // held image → dissolves into the churn
      } else {
        flushRevealWaiters()          // a revealResult() completed
      }
    }
  }

  function sizeOf(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) }
  }

  /** Create the engine on the two canvases. `frameEl` drives sizing (its box is
   *  observed; both canvases follow it). Idempotent — a second mount is ignored. */
  function mount(shaderCanvas: HTMLCanvasElement, revealCanvas: HTMLCanvasElement, frameEl: HTMLElement, opts: ImgFxMountOptions = {}) {
    if (inst || disposed) return
    const name = opts.preset ?? DEFAULT_PRESET
    const theme: PresetTheme = opts.theme ?? 'dark'
    const mode = PRESETS[name].modes[theme]
    cardBgColor = mode.cardBg
    const { w, h } = sizeOf(frameEl)

    try {
      inst = createInstance({ canvas: shaderCanvas, cssWidth: w, cssHeight: h, preset: mode, pixelScale: opts.pixelScale ?? 1 })
      reveal = createReveal({ canvas: revealCanvas, shaderCanvas, cssWidth: w, cssHeight: h })
      // ATTACH the reveal to the instance — the shared render loop draws it via
      // `inst.reveal?.afterShaderFrame(...)`, so without this the image never
      // paints (the reveal canvas stays blank). Mirrors the reference's
      // `instance.reveal = createReveal(...)` wiring.
      inst.reveal = reveal
      cycle = createCycle({ reveal, images: [], delayRange: [2, 4], holdMs: 2000, fadeOutMs: 300, onPhase })
      setInstanceVisible(inst, true)
    } catch (err) {
      // WebGL unavailable / context creation failed — degrade to no fx (the
      // glimm sweep still runs). Leave everything null so methods no-op.
      console.warn('[useImgFx] engine init failed, skipping effect:', err)
      cycle?.dispose?.(); cycle = null
      reveal?.dispose?.(); reveal = null
      if (inst) { try { destroyInstance(inst) } catch {} }
      inst = null
      return
    }

    // Only drive the instance's CSS size; img-fx owns BOTH canvases' backing
    // pixel dimensions (it sizes the reveal canvas to device px itself during
    // its render loop — do not touch revealCanvas.width/height here or the
    // reveal draws off-canvas / gets cleared).
    ro = new ResizeObserver(() => {
      if (!inst) return
      const s = sizeOf(frameEl)
      updateInstanceSize(inst, s.w, s.h)
    })
    ro.observe(frameEl)
  }

  const isMounted = () => !!inst

  /** Shader-only churn (the loading field). Safe to call repeatedly. */
  function churn() {
    if (inst) setInstanceVisible(inst, true)
  }

  /** Dissolve an existing image INTO the churn (the "regenerating" boil). Only
   *  meaningful from an idle/churn state; resolves once the boil has started. */
  async function boilFrom(url: string): Promise<void> {
    if (!cycle || disposed) return
    // triggerBoil needs a currently-held image, so reveal `url` first (holds it),
    // then boil on the 'visible' transition (see onPhase).
    if (phase !== 'idle') return
    boilOnVisible = true
    cycle.setImages([url])
    cycle.triggerOnce({ hold: 'manual' })
  }

  /** Dissolve a NEW image OUT of the churn and hold it. Resolves when the reveal
   *  animation completes (phase 'visible') — or after a safety timeout, so a
   *  caller (and the node's teardown) can never hang if the engine stalls. */
  function revealResult(url: string): Promise<void> {
    if (!cycle || disposed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve()
      }
      // A reveal must NEVER inherit a leaked boil intent — otherwise the next
      // 'visible' would boil this fresh image away instead of resolving here
      // (which left fxRevealing stuck → churn never torn down). Clearing it is
      // the root-cause fix for "the dither keeps going after generation".
      boilOnVisible = false
      revealWaiters.push(done)
      const fire = () => {
        cycle!.setImages([url])
        cycle!.triggerOnce({ hold: 'manual' })
      }
      // triggerOnce only fires from idle; if we're mid-reveal/boil, drop back to
      // idle first (triggerBoil is a no-op unless currently reveal/visible).
      if (phase === 'idle') fire()
      else { cycle!.triggerBoil?.(); fire() }
      // Safety net: resolve even if 'visible' never arrives (image load failure,
      // throttled rAF). Never leave the caller hanging.
      timer = setTimeout(done, REVEAL_SAFETY_MS)
    })
  }

  function dispose() {
    disposed = true
    boilOnVisible = false
    ro?.disconnect(); ro = null
    cycle?.dispose(); cycle = null
    reveal?.dispose(); reveal = null
    if (inst) { destroyInstance(inst); inst = null }
    flushRevealWaiters()
  }

  /** The active preset's card surface colour — paint this behind the shader
   *  canvas so the mosaic reads as a full-opaque field. */
  const cardBg = () => cardBgColor

  return { mount, isMounted, churn, boilFrom, revealResult, dispose, cardBg }
}

export type ImgFxController = ReturnType<typeof useImgFx>
