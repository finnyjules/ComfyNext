# ComfyNext — Rough Roadmap to Launch (gamed 2026-07-03)

One founder, sequenced strictly — the binding constraint is solo bandwidth, so nothing here is parallel except "frontier velocity" (new-model adoption), which stays a standing ~20% tax.

**The clock we're playing against:** Figma Weave's full embed into the main canvas lands "later this year" (announced Config 2026, with AI shader fills + canvas agent). Call it Q4 2026–Q1 2027. The game is: be *live, charging, and holding the wedge audience* (bursty prosumer creators, mispriced by every subscription) before their distribution machine reaches this lane.

**The two compounding bets** (from the moat analysis): user assets (characters/voices/LoRAs/brand kits = switching cost) and variables/pipelines (recurring workflows = churn resistance). Every phase below either finishes those or makes them chargeable.

---

## Phase A — Finish the product core (July 2026, ~3 wks)

The launch story is "directed, repeatable, on-brand generation" — the pieces must actually hold.

- Land variables/collections to the **"runs weekly for someone" bar**: batch generate from a collection through templates/characters/brand, retry/export solid. (In flight.)
- Clear the sign-off backlog: Lip-Sync Studio UI, Shot Director look, Pattern Studio, frame/nested-groups. Kill or fix, don't carry.
- One **hero pipeline demo** end-to-end: collection row → character → shot/poster → all formats → export. This is the launch video and the internal quality bar. (World Cup moment has passed — aim the demo at holiday-campaign season, which coincides with launch.)

Exit criteria: a stranger can watch the demo and repeat it.

## Phase B — Monetization rails (Aug–mid Sep, ~6–7 wks)

The accounts build, per the amended spec (all phases now designed, no research left):

| Week | Work |
|---|---|
| 1 | Phase 1: Clerk + Neon + login gate + **local-mode switch** |
| 2 | Phase 2: ledger + wallet UI + signup grant (150cr) + admin lookup/grant |
| 3 | Phase 3: Stripe checkout + webhook + packs ($10/25/**35**/50/100) |
| 4 | Phase 4: Metering A (provider proxies + training queue hold/settle) |
| 5 | Phase 5: Metering B — ws/iframe behind authed proxy, :8188 private, §7 pass-through from stored keys |
| 6–7 | Phase 5.5: worker pool + ownership-filtered /history //view //interrupt + per-user storage |

Deploy target: Hetzner CPX31 + Coolify (~€15/mo), R2 for assets. Guardrails (Phase 6) start here and never stop: prompt moderation + provider spend ceiling **before** any stranger runs a job on our keys.

Exit criteria: a second user cannot see the first user's anything; a $10 pack buys real generations; the meter reconciles to the penny for a week.

## Phase C — Private beta (mid Sep–Oct, ~4 wks)

20–50 hand-picked users (bursty-creator profile, not power-daily users — validate the wedge audience on purpose).

- Watch: nightly reconciliation drift, moderation misses, worker-pool contention, support load.
- Pricing tune from real usage: Seedance-1080p row (flagged above market anchor), the **daily draft drip** decision (counter to Krea's 100/day free tier — drafts cost ~$0.003 COGS), pack mix.
- Multi-tenant hardening of product data stores (LoRAs/voices/characters per-user) — surfaced by real second users, budget a week for the tail.

Exit criteria: 2 consecutive clean reconciliation weeks + ≥5 beta users who ran a *repeat* pipeline (the variables retention signal).

## Phase D — Public launch (Nov 2026)

- Story: **"Your credits don't expire"** (the one-liner) + the hero pipeline demo (the proof of category). Holiday-campaign batch generation is the seasonal hook.
- Channels: the ComfyUI/creative-tools communities first (founder credibility), then PH/X. Pricing page ships the market-anchor table.
- Revenue gates (from the costs model): **100 buyers/mo ≈ +$270/mo** = signal; **1,000 ≈ +$3,400/mo** = engine; $10k/mo profit ≈ 1,600 payers — a 2027 goal, not a launch goal.

## Phase E — Moat deepening (Dec 2026–Q1 2027)

In moat order, funded by launch revenue signal:

1. **Sharing v0** — publish/import templates + characters (the only network-effect moat available; also the counter to Figma Weave's full embed, which lands ~now on this timeline).
2. **$35/mo membership** — auto-deposited *rollover* credits + priority queue (attacks subscription incumbents' breakage model directly; needs Stripe + ledger, both live by then).
3. **LoRA flywheel promotion** — train-your-character as the chunky purchase → recurring high-margin inference.
4. GPU self-hosting **only if** the trigger fires (~25% L40S utilization ≈ 1,500 flux-class imgs/day) — a COGS lever, not a roadmap item until the metric says so.

## Standing risks & counters

- **Figma Weave embed** (Q4–Q1): counter = assets + pipelines + sharing land first; never fight on "generate an image on a canvas."
- **Provider price shock** (100% of COGS is API): counter = repriceable price book (in ToS), multi-provider seams already built (Replicate⇄fal).
- **Solo bandwidth**: counter = this sequence is strict; anything not on it is a chip for later. Frontier-model adoption is the only standing exception (~1 day/wk).
- **Fraud/abuse on operator keys**: velocity limits + spend ceilings ship *in* Phase B, not after an incident.
