/**
 * The decided credit ladder (pricing call 2026-08-13 — decision record in
 * docs/superpowers/specs/2026-08-13-pricing-proposal-draft.md). 1 credit =
 * $0.01, always; discounts exist ONLY as bonus credits so the rate is never
 * negotiable. Captions denominate work, not arithmetic (framing rules).
 */
export interface CreditPack {
  id: 'starter' | 'creator' | 'studio'
  usd: number
  credits: number
  baseCredits: number
  bonusCredits: number
  label: string
  caption: string
}

export const PACKS: CreditPack[] = [
  { id: 'starter', usd: 10, credits: 1000, baseCredits: 1000, bonusCredits: 0, label: 'Starter', caption: 'About a month of casual use' },
  { id: 'creator', usd: 25, credits: 2750, baseCredits: 2500, bonusCredits: 250, label: 'Creator', caption: 'A solid month for a regular user' },
  { id: 'studio', usd: 60, credits: 7200, baseCredits: 6000, bonusCredits: 1200, label: 'Studio', caption: 'A full heavy month in one top-up' },
]

export function packById(id: string): CreditPack | null {
  return PACKS.find(p => p.id === id) ?? null
}
