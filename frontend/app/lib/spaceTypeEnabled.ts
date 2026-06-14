/**
 * Space Type (the Three.js 3D-typography surface + its effect suite, starting
 * with the ribbon) is gated so it can merge hidden and be refined in place,
 * mirroring `lib/kineticEnabled`. Flip to `true` to expose the Add → Space Type
 * tile and the surface modal.
 *
 * Typed `boolean` (not the literal `false`) so the always-off branches don't
 * read as unreachable dead code to the type checker.
 */
export const SPACE_TYPE_ENABLED: boolean = false
