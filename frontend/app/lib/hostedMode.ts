/** Hosted-mode gate for client code. Strict boolean — a string 'true' from
 * env mangling must not accidentally enable auth UI. */
export function hostedModeEnabled(cfg: { hostedMode?: unknown }): boolean {
  return cfg.hostedMode === true
}

/**
 * The origin the canvas iframe and the client's engine fetches point at.
 *
 * Hosted has NONE (F3 rider). The engine is reachable only through the authed
 * same-origin proxy, which is where every Stage-5 tenant gate lives, so an
 * empty string here is what keeps the browser on the gated path. Hosted wins
 * over `comfyOrigin` unconditionally: a stray NUXT_PUBLIC_COMFY_ORIGIN in a
 * hosted environment must not be able to point the canvas at a raw engine, and
 * the old `|| 'http://127.0.0.1:8188'` fallback did exactly that even unset.
 *
 * Local behaviour is unchanged: the configured origin, else the operator's own
 * ComfyUI on :8188.
 */
export function engineOrigin(cfg: { hostedMode?: unknown, comfyOrigin?: unknown }): string {
  if (hostedModeEnabled(cfg)) return ''
  return (typeof cfg.comfyOrigin === 'string' && cfg.comfyOrigin) || 'http://127.0.0.1:8188'
}
