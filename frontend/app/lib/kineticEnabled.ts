/**
 * Kinetic Slates (the motion engine's editor surface + the slate template
 * gallery) is hidden pending a redesign of the feature. The implementation —
 * app/lib/motion/*, app/lib/slates/*, the templates, the modal controls — is
 * left intact; only the user-facing entry points are gated off.
 *
 * Flip to `true` to bring the whole kinetic surface back (Add → Slate gallery,
 * the Compositor's Motion preview / per-layer Animation panel / Bake controls,
 * and the dev slate-fixture button).
 *
 * Typed `boolean` (not the literal `false`) so the always-off branches don't
 * read as unreachable dead code to the type checker.
 */
export const KINETIC_ENABLED: boolean = false
