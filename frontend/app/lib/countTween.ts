/**
 * Pure math for the wallet pill's counter animation: the displayed number
 * rolls from the old balance to the new one instead of snapping. Kept free of
 * DOM/rAF so the easing and the animate-or-jump decision are unit-testable;
 * the rAF loop lives at the call site (layouts/default.vue).
 */

/** easeOutCubic — fast start, gentle landing; reads like a meter settling. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - Math.pow(1 - clamped, 3)
}

/** Integer value at `progress` (0..1) between two balances. Exact endpoints:
 * progress 0 → from, progress 1 → to, monotonic in between. */
export function tweenValue(from: number, to: number, progress: number): number {
  if (progress >= 1) return to
  if (progress <= 0) return from
  return Math.round(from + (to - from) * easeOutCubic(progress))
}

/** Animate only between two real, different balances. First paint (null →
 * value), sign-out (value → null), and no-op refreshes all jump instantly. */
export function shouldAnimateWalletChange(prev: number | null, next: number | null): boolean {
  return prev !== null && next !== null && prev !== next
}
