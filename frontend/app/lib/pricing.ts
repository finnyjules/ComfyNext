/**
 * Client-side price display for cost badges and run confirms.
 *
 * Local mode (the operator's machine): costs are the operator's own provider
 * spend — shown in dollars, unchanged.
 *
 * Hosted mode: users think and pay in credits (1 credit = $0.01 plus markup),
 * so every badge shows credits. The number here is an ESTIMATE derived from
 * the USD badge via the markup policy — the actual charge always comes from
 * the server price book (server/utils/priceBook.ts), whose hand-set entries
 * can diverge by a credit or two (e.g. sam-2 is booked at 4cr where the
 * formula gives 5). Hosted badges are therefore always shown approximate.
 *
 * POLICY MIRROR — if the markup policy changes, change BOTH here and the
 * price book: 2× on provider cost ≤ $0.10, 1.5× above, floor of 1 credit.
 */
export function creditsForUsd(usd: number): number {
  if (!(usd > 0)) return 0
  const markup = usd <= 0.10 ? 2 : 1.5
  return Math.max(1, Math.ceil(usd * 100 * markup))
}

/** Short badge text: "~$0.08" local, "~16 cr" hosted (hosted is always ~). */
export function formatCostBadge(usd: number, approximate: boolean, hosted: boolean): string {
  if (!hosted) return `${approximate ? '~' : ''}$${usd.toFixed(2)}`
  return `~${creditsForUsd(usd)} cr`
}

/** Longer text for dialogs: "$0.40" local, "~60 credits" hosted. */
export function formatCostLong(usd: number, hosted: boolean): string {
  if (!hosted) return `$${usd.toFixed(2)}`
  return `~${creditsForUsd(usd)} credits`
}
