# Costs & Pricing Model — ComfyNext Hosted

**Date:** 2026-07-01 (all prices web-verified this date)
**Status:** Draft for review. Companion to `2026-07-01-accounts-credits-billing-design.md` — answers its open question #3 (credit↔dollar rate, per-action costs) and informs Phase −1 (compute topology).

## 1. Cost structure

### 1.1 Fixed platform costs (monthly)

| Stage | Stack | Cost |
|---|---|---|
| Launch (free tiers) | Clerk free (50K MRU) + Neon free + R2 free (10GB) + Resend free + Sentry free + small Fly.io app | **~$10/mo** |
| Established (all paid) | Clerk $25 + Neon ~$5–20 + Fly ~$10 + Resend $20 + Sentry $26 | **~$85–100/mo** |
| Payments overhead | Stripe 2.9% + $0.30/txn, +0.5% Stripe Tax; $15/dispute | ~4–6% of revenue at $10 packs |

Fixed cost is a non-issue; **everything meaningful is variable (COGS)**.

### 1.2 Variable costs per action (provider COGS — basis for `price_book`)

**Self-hosted GPU** (RunPod Serverless L40S, $1.91/hr flex = $0.00053/s; the research's clear topology winner at launch):

| Action | Time (L40S) | COGS |
|---|---|---|
| SDXL image | ~2.4 s | ~$0.001 |
| Flux-dev image (28 steps, 1024²) | ~25–35 s | ~$0.015–0.02 (incl. overhead) |
| Light graph ops (composite bake, depth, local upscale) | seconds | <$0.005 |

**Replicate (verified per-action):**

| Action | COGS |
|---|---|
| flux-schnell draft | $0.003 |
| flux-dev | $0.025 · flux-1.1-pro $0.04 |
| nano-banana-2 edit | 1K $0.067 · 2K $0.101 · 4K $0.151 |
| Kling v2.5-turbo-pro video | $0.07/s → 5 s = $0.35 |
| Seedance 2.0 | 720p $0.18/s (5 s = $0.90) · 1080p $0.45/s (5 s = $2.25) · +~22% with video-reference input |
| LoRA training (1–2K steps, H100) | ~$1.85–4 (fast-trainer ~$1.46) |
| Trained-LoRA inference (private model, H100 time) | ~$0.004/image |
| Voice clone | $3.00 flat · TTS $0.10/1K chars |
| magic-image-refiner | ~$0.16 · Topaz upscale $0.08+/unit |

**Anthropic (agent/vibe features):** Haiku 4.5 $1/$5 per MTok → a vibe call ≈ $0.003–0.01; Sonnet/Opus agent plans ≈ $0.01–0.10+ per action (Opus 4.8 $5/$25; note newer models' tokenizer ≈ +30% tokens). Sonnet 5 intro pricing $2/$10 through Aug 2026.

### 1.3 Market anchors (what competitors charge)

- Images: ~$0.005–0.05 each at plan rates (Freepik sells nano-banana-2 at ~$0.054); images are loss-leaders everywhere.
- Video: **$0.05–0.15/s mid-tier** (Kling, Gen-4 Turbo), **$0.30–0.50/s flagship** (Gen-4.5, Veo/Sora class $2–3.50 per clip).
- Entry subscriptions cluster at **$8–15/mo**; prosumer $28–42; power $60–105.
- Aggregators (Higgsfield etc.) visibly run **1.5–3× markups** on model-API cost — our planned 1.5–2× is market-normal.
- **Almost everyone expires credits monthly.** Non-expiring prepaid credits (ours: ~12-mo ToS expiry) is an open positioning wedge held only by small PAYG players.

## 2. Proposed credit system

**1 credit = $0.01 retail.** Human-scale numbers (an image is "4 credits", not "0.004 packs"), clean mental math, and fine-grained enough to price drafts at 1.

### 2.1 Price book v1 (proposal)

| Action | Credits | Retail | COGS | Markup |
|---|---|---|---|---|
| Draft image (schnell / SDXL / own-GPU) | **1** | $0.01 | ~$0.001–0.003 | 3–10× (the "drafts feel free" lever) |
| Standard image (flux-dev, own GPU or Replicate) | **4** | $0.04 | ~$0.02–0.025 | 1.6–2× |
| Trained-LoRA image | **4** | $0.04 | ~$0.004 | high (recoups training subsidy) |
| Premium edit (nano-banana-2 1K / critique-loop repair) | **12** | $0.12 | $0.067 | 1.8× |
| Premium edit 2K | **18** | $0.18 | $0.101 | 1.8× |
| Upscale / refine | **14–28** | $0.14–0.28 | $0.08–0.16 | ~1.75× |
| Video, mid (Kling 2.5-turbo, per 5 s) | **60** | $0.60 | $0.35 | 1.7× |
| Video, flagship (Seedance 2.0 720p, per 5 s) | **160** | $1.60 | $0.90 | 1.8× |
| Video, flagship 1080p (per 5 s) | **400** | $4.00 | $2.25 | 1.8× |
| TTS (per 1K chars) | **18** | $0.18 | $0.10 | 1.8× |
| Voice clone (one-time) | **500** | $5.00 | $3.00 | 1.7× |
| LoRA training | **600** | $6.00 | $1.85–4 | 1.5–3× ("chunky visible purchase" per plan) |
| Vibe/agent tune action | **1–2** | $0.01–0.02 | ~$0.005 | ~2× (Haiku) |
| Agent compose/build action | **5–20** | $0.05–0.20 | varies by altitude (Sonnet/Opus) | ~2× |

Sanity vs market: our standard image $0.04 (market ≤$0.05 ✓), mid video $0.12/s (anchor $0.05–0.15 ✓), flagship $0.32–0.80/s (anchor $0.30–0.50, 1080p slightly above — flag for launch review).

### 2.2 Credit packs

| Pack | Credits | Bonus | Effective $/credit |
|---|---|---|---|
| $10 | 1,000 | — | $0.0100 |
| $25 | 2,625 | +5% | $0.0095 |
| $50 | 5,500 | +10% | $0.0091 |
| $100 | 11,500 | +15% | $0.0087 |

Minimum pack $10 (Stripe's $0.30 fixed fee makes $5 packs ~9% fee-loaded). Signup grant: **150 credits** (COGS exposure well under $1, enough for ~150 drafts or ~37 standard images — a real taste). Credits expire 12 mo (ToS), and **we market the non-expiry-within-a-year vs competitors' monthly expiry**.

What $10 buys (the marketing story): ~1,000 drafts, or 250 finals, or ~80 premium edits, or ~16 five-second mid-tier video clips, or one LoRA training + 100 finals.

### 2.3 Unit economics scenarios (blended 1.75× markup)

| Scenario | Revenue | COGS | Stripe | Fixed | Net |
|---|---|---|---|---|---|
| 0 users (idle) | $0 | ~$0 (serverless scales to zero) | — | ~$10 | **−$10/mo** |
| 100 buyers × $10/mo | $1,000 | ~$570 | ~$60 | ~$100 | **~+$270/mo** |
| 1,000 buyers × $10/mo | $10,000 | ~$5,700 | ~$590 | ~$150–300 | **~+$3,400/mo** |

The model is safe-by-construction: prepaid (no receivables), COGS scales with revenue, idle cost ≈ $10/mo. The margin is made or lost on **video** (biggest tickets, real COGS) and destroyed by **fraud/free-tier abuse** (hence the spec's velocity limits + signup-grant caps).

## 3. Compute topology input (feeds spec Phase −1)

> **REVISED 2026-07-03 — decision: NO GPU hosting for v1.** Everything heavy is already provider-API-billed (Replicate/fal/MiniMax); studios render in the user's browser; ComfyUI's local work is CPU orchestration plus two small CPU-able models (Depth Anything, LaMa). Launch host = one CPU VPS (Hetzner + Coolify, ~€10–15/mo, 8GB) running Nuxt + a ComfyUI worker pool (spec §6.5). COGS impact: flux-dev $0.02→$0.025/image (that row's markup 2.0×→1.6×); blended margin ~36–38%→~35–37% — inside noise, and strictly better at launch volume since idle GPU cost and cold starts disappear. The GPU options below are retained as the **scale-stage COGS lever**; adoption trigger ≈ 25%+ utilization of one L40S (~1,500 flux-class images/day). New consequence: 100% of COGS rides operator API accounts → Phase-6 spend ceilings + moderation protect the whole product.

- ~~**Launch:**~~ *(superseded, see above — retained as the scale-stage option)* serverless per-second GPU — RunPod Serverless (L40S $1.91/hr, first-party `worker-comfyui` image, network-volume model cache), Modal as the engineering-quality alternative (A100 $2.50/hr, <3 s container starts via memory snapshots). An always-on L40S is ~$713/mo and only breaks even at ~25% utilization — far above launch traffic.
- **Trade-off to design around: real cold starts of ~30–60 s** on first generation despite marketing claims. UX mitigation (queue messaging, warm-pool during active sessions) belongs in the Phase-0 spike.
- Replicate private deployments ≈ 1.8× raw GPU price with the worst scale-from-zero — use Replicate for its public per-action models (where its prices ARE the COGS above), not for hosting our engine.
- Growth path: one cheap always-on node (Vast.ai verified L40S ~$0.48/hr ≈ $350/mo or RunPod Secure $0.99/hr) for baseline latency + serverless overflow.
- Fly.io GPUs shutting down 2026-08-01 — excluded.

## 4. Pricing-model options considered

1. **Pure prepaid packs (recommended — this doc).** Matches the decided wallet plan; non-expiring(-ish) credits as the wedge; zero commitment matches "only pay for what you do."
2. **Packs + light subscription later.** Market standard ($9–15/mo with monthly credit drop at ~15–20% discount + perks). Adds MRR and retention; the monetization plan already earmarks this as a post-launch tier with auto-top-up as the stepping stone. Revisit at traction, not launch.
3. **Daily free drafts instead of one-time grant.** Krea/Leonardo-style retention lever; COGS is tiny (drafts ~$0.001–0.003) but it invites farm abuse — needs the velocity/abuse layer proven first. Candidate for post-launch experiment.

## 5. Path to $10k/mo profit

Net margin ≈ **36–38%** of revenue (COGS 57% at 1.75× blended + ~1–2% pack-bonus credits + ~5% blended Stripe/Tax), so $10k profit ⟹ **~$27–28k/mo revenue** (incl. fixed floor).

Persona mix 70% casual ($10/mo) / 25% regular ($25) / 5% power ($75) → **ARPPU ≈ $17/mo**.

| Scenario | ARPPU | Payers needed | Conversion | Monthly actives |
|---|---|---|---|---|
| Casual-heavy | $12 | ~2,350 | 3% | ~78,000 |
| **Base** | **$17** | **~1,650** | **5%** | **~33,000** |
| Video/prosumer-heavy | $30 | ~930 | 8% | ~12,000 |

Levers, in order of power:
1. **Markup 1.75×→2.0×**: net margin ~44%, revenue needed drops to ~$23.5k → ~1,400 payers (base mix). Still market-normal.
2. **Video share drives ARPPU** ($10 image-only plateau vs $30 video users): prosumer scenario needs half the payers of base. Product emphasis on video > conversion optimization.
3. **Signup-grant growth tax**: each free signup costs $0.30–0.80 COGS (150-credit grant; capped ~$0.80 even if spent on premium edits). Sustaining 33k actives ⇒ thousands of signups/mo ⇒ ~$1–3k/mo — velocity/abuse guardrails are economically load-bearing.

## 6. Product levers for ARPU

Margin is uniform across actions, so ARPU is a volume game: build **escalators** (cheap action → expensive next step at the moment of investment). Ranked; build order for 1–3 in `2026-07-01-arpu-levers-build-order.md`:

1. **Finish Shot Director v1** — the image→video bridge; ~70% built, missing generation wiring.
2. **"Animate this" on every image** — ambient image→video escalator (Film a Shot / Shot Director spawn), cheapest build.
3. **Takes & variations mechanics** — video takes strip + "×4 variations" images; multiplies actions per session.
4. **Proactive finishing stack** — critique-loop/enhance/upscale surfaced as one-tap next steps after finals (12–28cr each).
5. **Variables & data-merge (un-park)** — the only ×N batch lever; targets the $75+ persona.
6. **Character/brand LoRA flywheel** — chunky purchase → high-margin recurring inference + lock-in.
7. **Agent as orchestrator** — one request executes a bundle of billable actions.
8. **Auto-top-up** (post-launch) — ARPU protection at the run-out moment.

Boundary: escalators are offers, not traps — trust (non-expiring credits, no charge on failures) is the wedge.

## 7. Risks & caveats

- All prices retrieved 2026-07-01; Replicate/GPU prices drift — `price_book` versioning exists precisely for this. Re-verify at Phase-3 build time.
- Seedance 1080p retail ($0.80/s) sits above the flagship market anchor; either accept (premium positioning) or thin the margin on that one row.
- Anthropic agent features at Opus/Fable altitude can quietly out-cost image generation — agent actions must be in the price book, not absorbed.
- Stripe effective take is ~6% on $10 packs, ~4% on $50 — bonus tiers deliberately push pack size up.
- Nightly reconciliation (spec §8) is what catches COGS drift vs this table in production.
