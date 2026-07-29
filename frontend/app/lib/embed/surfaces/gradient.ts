import type { EmbedSurface, EmbedHandle } from '../contract'
import { GradientFxRenderer } from '~/lib/gradientfx/renderer'
import { motionConfigFor } from '~/lib/gradientfx/motion'
import type { GradientConfig } from '~/lib/gradientfx/types'

/**
 * Gradient is fully procedural — GradientConfig references no images, textures
 * or URLs — so an embed carries no asset payload at all.
 *
 * Do NOT import ~/lib/gradientfx/frameSource here: it holds a module-level
 * `ref(0)` and would drag Vue into the bundle.
 */
export interface GradientEmbedConfig {
  cfg: GradientConfig
  /** Loop length in seconds. render() takes seconds, not t01. */
  duration: number
}

const gradientEmbedSurface: EmbedSurface = {
  kind: 'gradient',
  // Measured, not assumed (Task 2 Step 7): the GL context is requested without
  // an explicit `alpha` attribute (defaults to true), but GRADIENT_FS always
  // starts `col` from the opaque `u_bg` background and hardcodes the alpha it
  // writes to whatever reaches the canvas to 1.0 — see the `fragColor = vec4(
  // ..., u_grainDeferred > 0.5 ? cover : 1.0)` line in shaders.ts. `cover` (which
  // can be < 1) only escapes into the alpha channel when blur is active, and
  // even then it lands on the offscreen scene FBO, not the canvas — the BLUR_FS
  // pass that draws the visible canvas afterwards also hardcodes alpha to 1.0.
  // So the canvas Gradient hands back is always fully opaque.
  caps: { alpha: false },

  async mount(container: HTMLElement, config: unknown): Promise<EmbedHandle> {
    const embed = config as GradientEmbedConfig
    if (!embed?.cfg) throw new Error('gradient embed: config has no cfg')
    // Without this, a config missing `layers` reaches render() (renderer.ts
    // does `c.layers.slice(...)`), throws a TypeError, mount() rejects, and
    // the runtime's poster-fallback catch swallows it silently — the export
    // just shows a static poster forever with no visible error. Fail loudly
    // here instead, at export/bake time, where the studio surfaces the message.
    if (!embed.cfg.layers?.length) throw new Error('gradient embed: config has no layers')

    // render() applies motion internally against cfg.motion.duration (both
    // applyMotion and the flow-churn loop phase in renderer.ts key off it),
    // but `draw` below feeds it seconds derived from embed.duration — a
    // DIFFERENT clock. If the two ever diverge, every track (and the churn
    // loop) evaluates at the wrong rate and the loop would not close cleanly
    // at t01 = 1. Reconciled once here, at mount, rather than per-draw:
    // setTime is on the hot path and must stay synchronous and
    // allocation-light, and this only needs to happen once since embed.cfg
    // and embed.duration are both fixed for the handle's lifetime. Mirrors
    // the shader adapter's identical guard (~/lib/embed/surfaces/shader.ts).
    const cfg = motionConfigFor(embed.cfg, embed.duration)

    // Own instance, not the globalThis-cached singleton — two embeds on one
    // page must not share a GL context.
    const renderer = new GradientFxRenderer()
    let w = Math.max(1, container.clientWidth || 512)
    let h = Math.max(1, container.clientHeight || 512)
    let mounted: HTMLCanvasElement | null = null

    const draw = (t01: number) => {
      // render() applies motion internally (renderer.ts imports applyMotion),
      // so the adapter must NOT apply it again — that would double-apply.
      // `time` is in SECONDS.
      const out = renderer.render(cfg, w, h, t01 * embed.duration)
      if (out !== mounted) {
        if (mounted) mounted.remove()
        out.style.display = 'block'
        out.style.width = '100%'
        out.style.height = '100%'
        container.appendChild(out)
        mounted = out
      }
    }

    draw(0)

    return {
      setTime: (t01: number) => draw(t01),
      setSize: (nw: number, nh: number) => {
        w = Math.max(1, Math.round(nw))
        h = Math.max(1, Math.round(nh))
      },
      destroy: () => {
        if (mounted) { mounted.remove(); mounted = null }
        // Mirrors the shader adapter: release the GL context, don't just
        // detach the canvas. Browsers cap live contexts at ~16.
        renderer.dispose()
      },
    }
  },
}

export default gradientEmbedSurface
