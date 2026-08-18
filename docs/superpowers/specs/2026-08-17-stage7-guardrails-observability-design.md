# Stage 7 — Guardrails & Observability: design

**Plain summary:** four safety nets for the hosted beta, all off in local mode. (1) A quick prompt safety check before any paid generation, so a ToS-violating prompt can't get the shared provider account banned. (2) Error alerts (Sentry) so a beta failure reaches the operator instead of dying silently. (3) An emergency brake — a global daily provider-spend ceiling plus kill-switches — the one thing prepaid credits don't cover (a *bug* over-spending). (4) A nightly money check that flags provider spend the ledger never charged a user for. Metering (Stages 4–6) already bounds per-*user* budget, so this stage is deliberately small.

**Scope:** a 5-user *watched* private beta, not a public launch. Everything hosted-only, gated on `deployMode() === 'hosted'`; local mode byte-identical.

## Global constraints (same as every hosted stage)

- No `NUXT_CLERK_SECRET_KEY` ⇒ local mode ⇒ byte-identical. Every new behavior behind `deployMode() === 'hosted'` or an env presence check. Local `:3000` regression is part of final verification.
- New hosted keys (`OPENAI_API_KEY`, `SENTRY_DSN` / `NUXT_PUBLIC_SENTRY_DSN`) live ONLY in gitignored `frontend/.env.hosted`; never printed.
- New tables use the `connectLedgerDb` own-session pattern (`graphRuns.ts`/`resourceOwners.ts`), never the ledger's shared session.
- No commas in trailing comments on `export const` lines under `frontend/server/`.
- Fail-closed for spend controls (a bug or unknown state pauses spend); fail-OPEN for the moderation check when OpenAI is unreachable (see Component 1 rationale).

## Component 1 — Prompt-side moderation

**What:** before any paid provider call, run the prompt text through OpenAI's moderation endpoint (`omni-moderation-latest` — free, purpose-built for ToS categories). A flagged prompt refuses the action with a clear message; any credit hold is released, nothing is charged.

**Two insertion points, mirroring the metering chokepoints:**
- **Nitro provider routes** (mini-apps + direct): moderate the prompt field at the same chokepoint metering uses (`runReplicate`/`runFal` see the input dict). A refusal releases the ticket (the existing `ticket.release()` path) and throws a `MeterRefusalError`-style 400.
- **Canvas graph submission** (`meterGraphSubmit` in `meterGraphRun.ts`): before forwarding, extract text from the graph's known prompt-bearing inputs (`prompt`, `text`, `positive`, `negative` on any node) and moderate the joined string. Runs BEFORE the hold, so a refusal costs nothing (same ordering as the Stage-6 file-ref validation: validate before the hold).

**Classifier module** (`server/utils/moderation.ts`): `moderatePrompt(text): Promise<{ ok: true } | { ok: false, categories: string[] }>`. Local mode / no `OPENAI_API_KEY` → `{ ok: true }` (no-op, byte-identical). Purely additive, injectable for tests.

**Fail-open on OpenAI outage — deliberate.** If the moderation call errors or times out (short timeout, e.g. 4s), the prompt is ALLOWED and the failure is reported to Sentry + logged. Rationale: moderation here is defense-in-depth over 5 known/watched users; a hard fail-closed would take all generation down on any OpenAI blip. The residual risk (a bad prompt slips through during an OpenAI outage) is acceptable for a watched beta and revisited before public launch. This is a recorded decision, not an oversight.

**Empty/no-text graphs** (e.g. a pure image-to-image with no prompt) skip moderation cleanly.

## Component 2 — Observability (Sentry)

**What:** `@sentry/node` on the server + `@sentry/nuxt` (or the browser SDK) on the client, initialized ONLY when the DSN env is present (⇒ hosted-only; local unaffected). Captures unhandled errors + explicit `captureException` at the money/engine chokepoints already logging `console.error` (metering debit failures, settle-on-released-hold, moderation-unavailable, reconciliation drift).

**Privacy:** do NOT send prompt text or user PII in error payloads — scrub/limit breadcrumbs; identify users by Clerk id only. This is error monitoring, not analytics.

## Component 3 — Operator safety valves

**What:** the backstop for a *bug* spiking spend (prepaid credits bound per-user spend, but a metering bug could over-dispatch). Two mechanisms, both checked at `preflightForUser` (`requestMeter.ts`) — the single point every paid action passes through — BEFORE the hold:

- **Kill-switches** (`system_controls` table, own pg session): a global `paused` flag and a per-user `disabled` set. Tripped → `MeterRefusalError(503, 'temporarily paused')`, no hold, nothing dispatched. Flipped by the operator via a tiny admin route (`/api/admin/*`, already 404-in-hosted-guarded — extend it) or direct SQL.
- **Daily provider-spend ceiling:** a configured USD ceiling (env `SAILOR_DAILY_PROVIDER_CEILING_USD`). At preflight, if today's summed `provider_usage.usd` ≥ ceiling → pause new paid actions (same 503) + alert once. The sum is cached briefly (~30s) so it's not a per-request query.

Both are hosted-only. A missing/unreadable control state fails CLOSED (pause) — the opposite of moderation, because an unknown spend-control state is a money risk.

## Component 4 — Nightly reconciliation

**What:** a hosted-only cron (reusing the `holdSweep` plugin pattern — schedule-only, never blocks boot) that once a night:
- Finds `provider_usage` rows from the last day whose `job_id` has **no matching ledger debit** — i.e. operator money spent that no user was charged for (the money-leak bug class). Any hits → alert (Sentry + log) with the job ids.
- Emits a daily summary: total provider cost vs total credits charged (the margin), so a pricing regression shows up as a shrinking/negative margin that night, not in a monthly invoice.

No auto-correction — it alerts, the operator investigates. (Charged is expected to *exceed* cost by the markup; the check is for *unmatched* spend and *negative* margin, not equality.)

## Deferred (YAGNI for 5 watched users — recorded, not forgotten)

- **Output-side moderation** (scanning generated images): the operator chose prompt-side only; the output classifier is an unsolved design choice (which model/service), adds latency+cost per gen. Revisit before public launch.
- **Rich product analytics:** 5 hand-picked users are observed directly; a basic event log suffices, full analytics rides to Stage 8's launch surfaces.
- **Stripe Radar / payment-fraud config:** known users, small beta; later.

## Verification

- Local `:3000` byte-identical: no OpenAI/Sentry/ceiling/kill-switch behavior when the env keys are absent (assert no moderation call, no Sentry init, no controls query).
- Hosted: a flagged prompt refuses + releases hold (nothing charged); OpenAI-down → fail-open + Sentry event; kill-switch flip → 503 on next paid action; ceiling breach → 503 + alert; reconciliation cron flags a synthetic unmatched `provider_usage` row.
- RED-first for the moderation gate, the preflight controls, and the reconciliation query.
