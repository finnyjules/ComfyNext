# Pricing Proposal — Credit Packs from Observed Usage

**Date:** 2026-08-13
**Status:** **DECIDED 2026-08-13 (Julien)** — see the decision record below. Gap #28 closed; Stripe phase unblocked.

---

## DECISION RECORD (2026-08-13)

**Plain summary of what was decided:** credits cost 1¢ each, always. Three packs: **$10 → 1,000 credits · $25 → 2,750 (+10% bonus) · $60 → 7,200 (+20% bonus)**. New signups get **100 free credits**. The two money-losing prices are fixed and LoRA renders are priced as a category. All implemented in price book `spike-v3`.

Deviations from the draft below, and why:

1. **The $5 entry pack was rejected (Julien's call) — the ladder is $10/$25/$60, not $5/$15/$40.** Rationale: Stripe's fixed fee eats 9% of a $5 charge; the lowest visible price anchors the product's perceived value and Sailor is positioned for practitioners (comparable tools start at $10–15); small SKUs attract the lowest-margin cohort and card-testing fraud. The 100cr signup bonus already serves as the low-friction trial.
2. **Round prices, deliberately.** The left-digit effect ($9/$24/$59) was considered and rejected: 9-endings carry a "discount" signal that conflicts with the professional positioning, and $10 = 1,000 credits is *self-verifying* arithmetic — a customer can check the honesty of the whole system in their head. Digit-ending effects are second-order at this scale; pack structure and framing carry the revenue weight.
3. **Pricing-page framing rules** (bind the future Stripe build + pricing page):
   - Discounts appear ONLY as bonus credits ("+250 credits free"), never as % off — the 1¢ rate is never discounted, so it stays the stable reference price.
   - Creator ($25) gets the "Most popular" treatment (compromise effect); Studio anchors the page.
   - Packs are captioned in work, not arithmetic ("~a month of regular use"), translating credits into outcomes.
   - Bonus expiry 30 days, purchased-credit expiry ~12 months, both stated in plain sight.
   - Re-buy is one click, defaulting to the user's last pack; suggest the next pack up when the last one burned fast.
   - No fake scarcity, no countdown timers, no dark patterns — transparent per-action costs are Sailor's trust wedge.
4. **LoRA category pricing accepted as recommended:** LoRA-remote render = 8cr, Restyle-with-LoRA = 18cr, slug-independent (route-level). Implemented in `spike-v3` for the graph path; Stage 4's direct-route metering must use the exported category constants for any LoRA slug missing from `MODEL_COSTS`.
5. **Below-policy prices fixed now, as recommended:** LipSync 30 → **150cr**, graph EditImage 12 → **23cr** (parity with the direct route). FilmShot's suspected over-pricing is NOT changed — re-verify against a live invoice first, with the rest of the `estimate`-confidence rows, in the pre-launch sweep.
6. **Signup bonus set to 100cr** (was provisionally 200 during the Stage 1 build; `SIGNUP_BONUS_CREDITS` updated).

**Unit-economics note from the decision discussion:** at this ladder, $10k/month gross margin ≈ ~350 all-heavy users, ~1,150 all-medium, or ~1,400–2,000 at realistic mixes — the $60 pack's health (heavies topping up without churn) is the single most valuable pricing property to protect.

---
**Inputs:** `frontend/.data/spend-events.jsonl` (named-model spend log), `user/sailor/spend.jsonl` + per-project `generations.jsonl` (historical cost ledger), `frontend/server/utils/priceBook.ts` (price book spike-v2), billing design spec 2026-07-01, roadmap 2026-08-11.

---

## Plain-language summary

We looked at every paid image/video call Julien actually made while using Sailor day to day, to decide what to charge people. Over six weeks of real use (June 9 – July 20), 552 paid generations cost about **$31 total** — a typical working sitting costs **around 20–50 cents** in provider fees, a big day costs a few dollars. Most actions cost 3–9 cents each; a few (video, lip-sync, 3D) cost 40 cents to a dollar.

The proposal: sell prepaid credits at **1 credit = 1 cent**, in three packs — **$5, $15 (+10% bonus credits), $40 (+20% bonus)** — and give every new signup **100 free credits** (about three typical sessions). Cheap actions are marked up 2×, expensive ones 1.5×, so a light user spends a few dollars a month and a heavy user like Julien spends $40–80 a month, with roughly half of that being profit before Stripe fees.

Three problems were found in the current price table: personal-LoRA renders — **half of all observed spend** — have no price at all; the lip-sync action is priced **below what it costs us** (we'd lose 70 cents per run); and the model names the new spend log records don't all match the price table's names, so some real calls can't be priced. All three need fixing before launch.

---

## 1. What data we actually have (and its limits)

Be honest about the sample before trusting the numbers:

- **The named-model spend log (`frontend/.data/spend-events.jsonl`) effectively started today.** The `spendLog.ts` instrumentation landed 2026-08-11, but the file was only created 2026-08-13 13:42 (the running dev server picked the code up on today's restart). It holds **5 events**, all from a two-minute burst today: 1× `finnyjules/jules-jene` (personal LoRA on Replicate), 3× `google/nano-banana-pro` (Replicate, one failed), 1× `fal-ai/nano-banana-pro/edit` (fal). Useful for slug-join verification, useless for volume statistics.
- **The real usage history is the older backend ledger:** `user/sailor/spend.jsonl` (552 paid events, $31.37) plus per-project `generations.jsonl` (1,597 generations total, 552 paid), covering **2026-06-09 → 2026-07-20, 26 active days**. After July 20 generation moved to the direct fal/Replicate routes, which were unmetered until this week — so **late-July/August usage is invisible**.
- **The `usd` figures are frontend badge estimates** (`usdApproximate: true`), not provider invoices. They come from the same static badges the cost gate uses; they're the right order of magnitude but not reconciled against Replicate/fal bills.
- **n = 1 user, and that user builds the tool.** Test renders, verification runs, and demo bursts are mixed into "real" use. Treat every extrapolation below as a shape, not a forecast.
- **The mix has shifted expensive since the sample.** The historical median action is $0.03–0.05; today's five live events are dominated by nano-banana-pro at ~$0.15/call. Recent sessions likely cost 2–3× the historical medians.

## 2. Observed usage

### Totals

| Metric | Value |
|---|---|
| Window | 2026-06-09 → 2026-07-20 (6 weeks, 26 active days) |
| Paid generations | 552 (of 1,597 total — 65% of generations were free/local) |
| Total provider cost | **$31.37** |
| Best rolling 30-day window | **$30.34** (starting 2026-06-09) |
| Cost per active day | median ≈ $0.40, mean ≈ $1.21, max $8.26 (2026-06-24) |

### Spend by action (paid generations, attributed by node signature)

| Action | Runs | Total $ | Median $/run |
|---|---|---|---|
| GenerateImageNode | 112 | $3.40 | $0.03 |
| FluxMultiLoRARemoteNode | 111 | $4.44 | $0.04 |
| RestyleWithLoRANode | 96 | $8.64 | $0.09 |
| FluxLoRARemoteNode | 70 | $2.76 | $0.04 |
| EditImageNode | 55 | $2.80 | $0.05 |
| RelightNode | 25 | $1.45 | $0.05 |
| BlendSceneNode | 24 | $0.95 | $0.04 |
| UpscaleImageNode | 17 | $1.30 | $0.10 |
| SplitPhotoLayersNode | 17 | $0.15 | $0.01 |
| RemoveBackgroundNode | 17 | $0.05 | $0.001 |
| EnhanceDetailNode | 10 | $1.00 | $0.10 |
| GenerateVideoNode | 4 | $1.20 | $0.40 |
| FilmShotNode | 2 | $0.80 | $0.40 |
| LipSyncNode | 1 | $1.00 | $1.00 |

**Headline: LoRA-family renders (Restyle + Flux LoRA single/multi) are ~$15.8 of $31.4 — 50% of all observed spend** — and none of them are priced in the price book's model table (see §4).

### Distribution of per-action costs

Per-event provider cost across all 552 paid runs: min $0.001 · p50 **$0.04** · p75 $0.05 · p90 $0.09 · p99 $0.40 · max $1.00. Concentration: 87% of events cost $0.03–0.10; only 13 events (2.4%) cost ≥ $0.14. Cheap actions dominate volume; expensive actions dominate tail risk.

### What a working session costs

Splitting events on 45-minute gaps gives **68 sessions**:

| | Provider cost | At 2× retail |
|---|---|---|
| Median session (3 events, ~3 min) | **$0.18** | ~36 credits ($0.36) |
| p75 session | $0.52 | ~104 credits |
| p90 session (23 events, ~1 hr) | $1.00 | ~200 credits |
| Max session (109 events) | $7.70 | ~1,540 credits |

Most sessions are short bursts (median 3 events); the long tail is a real working hour of 20–100+ renders.

### Extrapolated user-months (provider cost → retail at 2×)

| Archetype | Shape | Provider $/mo | Retail credits/mo | Retail $/mo |
|---|---|---|---|---|
| **Light** | ~8 short sessions/mo | ~$1.50–3 | 300–600 | $3–6 |
| **Medium** | ~12 active days, mix of short + p75 sessions | ~$8–12 | 1,600–2,400 | $16–24 |
| **Heavy** (= the operator's best 30 days, adjusted up for today's pricier models) | ~20 active days incl. big days | $30 observed → **$35–50 realistic** | 5,000–8,000 | $50–80 |

Add occasional LoRA training (~$2.50/run, 600 credits charged) on top for medium/heavy users. Caveat repeated: this is one power user's shape scaled, not a cohort.

## 3. Credit-pack proposal

### Rate and packs

**1 credit = $0.01, fixed.** Discounting happens via bonus credits, never via a variable rate — the meter math and ledger stay trivial and the pricing page stays honest.

| Pack | Price | Credits | Effective bonus | Covers |
|---|---|---|---|---|
| **Starter** | $5 | 500 | — | ~14 median sessions, or 2–3 heavy hours |
| **Creator** | $15 | 1,650 | +10% | a medium month |
| **Studio** | $40 | 4,800 | +20% | most of a heavy month (heavy users re-buy ~1.5×/mo → ~$60/mo revenue vs ~$35 provider cost) |

Anchor logic: the median session retails at ~36 credits and a serious hour at ~200, so the $5 pack is unmistakably "weeks of casual use", not a teaser. $40 is deliberately below a heavy month so power users top up rather than churn on sticker shock.

### Signup bonus

**100 credits** (~3 median sessions, or ~5–8 image generations on today's premium models). Worst-case provider exposure per free signup ≈ $0.50–0.65; bounded further by top-up velocity limits (already planned in Stage 3) and a 30-day bonus expiry (FIFO consumption in the ledger already burns expiring grants first).

### Margin table — top-10 most-used actions

Observed median provider cost → credits charged (ceil, 1-credit floor) → gross margin (share of charge kept), at both markups. "Book today" is the current spike-v2 entry where one exists.

| Action | Provider $ (obs. median) | 1.5×: credits / margin | 2×: credits / margin | Book today |
|---|---|---|---|---|
| GenerateImageNode (flux-dev class) | $0.03 | 5 cr / 40% | 6 cr / 50% | flux-dev = 5 cr ✔ |
| FluxMultiLoRARemoteNode | $0.04 | 6 cr / 33% | 8 cr / 50% | **unpriced** |
| RestyleWithLoRANode | $0.09 | 14 cr / 36% | 18 cr / 50% | **unpriced** |
| FluxLoRARemoteNode | $0.04 | 6 cr / 33% | 8 cr / 50% | **unpriced** |
| EditImageNode (nano-banana era: $0.15) | $0.05 → $0.15 | 23 cr / 35% | 30 cr / 50% | 12 cr graph / 23 cr direct (conflict, §4) |
| RelightNode | $0.05 | 8 cr / 38% | 10 cr / 50% | unpriced |
| BlendSceneNode | $0.04 | 6 cr / 33% | 8 cr / 50% | unpriced |
| UpscaleImageNode | $0.10 | 15 cr / 33% | 20 cr / 50% | unpriced |
| SplitPhotoLayersNode | $0.01 | 2 cr / 50% | 2 cr / 50% | unpriced |
| RemoveBackgroundNode | $0.001 | 1 cr / 90% | 1 cr / 90% | 851-labs = 1 cr ✔ |

Recommended policy (matches what the price book already does for its verified entries): **2× on actions ≤ $0.10 provider cost, 1.5× on actions above it** (video, 3D, training, nano-banana tier), 1-credit floor everywhere. Blended across the observed mix this yields ~45–50% gross margin before Stripe's ~$0.45 on a $5 checkout — another argument for nudging users toward the $15/$40 packs.

## 4. Price-book disagreements and gaps (pricing bugs)

Found by joining the spend logs against `frontend/server/utils/priceBook.ts` (spike-v2):

1. **LoRA-family inference is entirely unpriced — and it's 50% of observed spend.** `RestyleWithLoRANode`, `FluxLoRARemoteNode`, `FluxMultiLoRARemoteNode` have no entry in either `PREMIUM_ACTION_CREDITS` or `MODEL_COSTS`, and the live spend log's `finnyjules/jules-jene` (personal fine-tune slug) can never match a static table keyed by public slugs. Personal-model slugs need a pattern/category rule (e.g. any `finnyjules/*` or LoRA-remote route → flat 8 cr; Restyle → 18 cr), not per-slug rows.
2. **LipSyncNode is priced below cost.** Graph table charges 30 cr ($0.30); the one observed run cost **$1.00** — a ~70-cent loss per run. Should be ≥ 150 cr at 1.5×. (Consistent with the known cost-confirm-gate gap: Lip-Sync's dispatch-site cost override is still owed.)
3. **EditImageNode is priced differently on its two paths.** Graph table: 12 cr. Direct-route table (`fal-ai/nano-banana-pro/edit`): 23 cr. Same user action, ~2× price difference depending on which surface ran it — and if edits now go through nano-banana-pro ($0.15), the 12 cr graph price is *at cost* (1.0× markup, ~0% margin after fees).
4. **Spend-log slugs don't all join.** Observed `google/nano-banana-pro` (Replicate) has no row — the book only carries `fal-ai/nano-banana-pro`. Every provider-specific alias of the same model needs a row (or a normalization step), and Replicate's rate should be verified rather than assumed equal to fal's $0.15.
5. **FilmShotNode markup is 4×, over policy.** 160 cr ($1.60) vs observed $0.40/run (both observed runs). Either the badge estimate is wrong (Seedance 720p/5s at $0.40 is plausible) or the 160 cr price is stale; at 1.5× the price would be 60 cr. Verify against a live Seedance invoice before repricing.
6. **GenerateVideoNode checks out** (60 cr vs $0.40 observed = 1.5× ✔) and **LoraTrainingNode is mildly over policy** (600 cr vs $2.50 estimate = 2.4× — defensible for hardware-billed variance, but note it's an `estimate`-confidence row that must be re-verified before launch, like all 10 `estimate` rows).

## 5. Three decisions for Julien

1. **Do we ship the $5 / $15 (+10%) / $40 (+20%) ladder at a fixed 1¢/credit, with a 100-credit signup bonus?**
   *Recommended: yes.* It's anchored on what sessions actually cost, keeps the meter math integer-clean, and bounds free-tier exposure to well under $1/signup. Revisit pack sizes after 30 days of real beta data — the ledger will finally be recording strangers, not the toolmaker.

2. **How do personal-LoRA renders get priced — per-slug, or as a category?**
   *Recommended: category rule.* Any LoRA-remote inference = 8 cr, RestyleWithLoRA = 18 cr, regardless of slug; implemented as a route-level price (the dispatching route knows it's a LoRA call) rather than a `MODEL_COSTS` lookup that can never enumerate user fine-tunes. This closes the single biggest revenue leak in the current book (50% of observed usage currently unpriceable).

3. **Fix the two below-policy prices (LipSync 30→150 cr, EditImage graph 12→23 cr) now, or at re-verification?**
   *Recommended: now, in spike-v3, before any beta user exists.* LipSync loses money on every run and EditImage's graph path is at ~0% margin; both are one-line table edits. At the same time, schedule the launch-blocking sweep the book itself demands: re-verify all `confidence: 'estimate'` rows and add the missing Replicate slug aliases — and let the now-live `spend-events.jsonl` accumulate 2–3 weeks of named-model data so the next pricing pass joins real slugs to real volumes.

---

*Method note: session = paid events separated by >45 min gaps; per-action medians use solo-signature runs only (multi-node graph runs excluded from medians, included in totals); retail figures assume the 2×/1.5× tiered policy with 1-credit floor.*
