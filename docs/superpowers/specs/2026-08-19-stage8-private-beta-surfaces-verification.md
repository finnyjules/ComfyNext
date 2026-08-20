# Stage 8 — private-beta launch surfaces: verification record + operator checklist

**Plain summary:** the pieces that make it safe and presentable to invite the five beta users. (1) A guest list: `SAILOR_BETA_ALLOWLIST` (emails, hosted env only) — anyone signed in who isn't on it gets no wallet, no free credits, and a "Sailor is in private beta" screen; an empty/unset list denies *everyone*, so a forgotten config fails safe. This closes the open spend hole where any stranger who found the URL got 100 credits of real provider budget. (2) Legal cover: `/terms`, `/privacy`, `/content-policy` (honest beta drafts, flagged for counsel before public launch) plus Clerk's "I agree to the Terms & Privacy Policy" checkbox at sign-up, live on the dev instance. (3) Clear refusals: a blocked prompt / empty wallet / paused system now shows a readable canvas notice instead of failing silently. Local mode is byte-identical except the legal pages, which are deliberately public in both modes.

## What the stage built (7 task commits + 6 verification-driven fixes; base 6a0d39f85; final whole-branch review: READY after the fix wave)

- **Beta allowlist** (`betaAccess.ts`): pure parse/check + per-user memoized email lookup; fail-CLOSED (unset list, missing email, or failed Clerk lookup ⇒ deny). Enforced at BOTH bonus-grant paths — the auth middleware's attach branch (403 `beta_not_invited` BEFORE identity attach, meter bind, or lazy wallet+bonus provisioning) and the Clerk `user.created` webhook (skip sync, ack 200 so Clerk doesn't retry). Same parse + compare functions and env var on both paths, so they cannot disagree. Adding an email later provisions the user on their next request — no re-signup.
- **Gate screen** (`BetaGate.vue` + `betaGate.ts` + layout wiring): full-screen "Sailor is in private beta" with the signed-in email, a Sign out button, and legal links; triggered by the wallet fetch's 403; recognizes both h3 body nestings (live shape confirmed: flat `data.code`).
- **Legal pages** (`LegalShell.vue` + three pages): plain-language beta drafts — credits prepaid/repriceable/non-refundable-except-by-law and currently non-expiring (expiry only reserved for future grants with ≥30 days' notice); the six moderation categories; the real processor list (Clerk, Stripe, Neon, Sentry, Replicate/fal.ai/Anthropic, OpenAI moderation); operated-by-Julien sole proprietor; every page banner-flagged "Beta draft — reviewed by counsel before public launch."
- **Consent at sign-up:** Clerk's native legal-acceptance (`compliance.legal_consent`) enabled on the DEV instance via the Backend API, pointing at `/terms` + `/privacy`; the sign-up card now requires the checkbox. Prod re-run steps in [stage8-deploy-notes](2026-08-19-stage8-deploy-notes.md).
- **Refusal surfacing** (bridge + `queueRefusal.ts` + canvas): the bridge now recognizes h3-shaped refusal bodies (message + statusCode, no node_errors) from the metering chokepoint and tags them `refusal`; the canvas shows the server's message as a toast — moderation refusals add a "Content policy" action linking `/content-policy`. ComfyUI validation errors keep their exact old path (per-node red rings).
- **Live-verification fixes (found by actually driving the app):** a refusal double-toasted (the layout's pre-existing generic `queue_error` listener stacked on the new specific toast — suppressed for refusals, state cleanup preserved); legal pages and the sign-up/sign-in pages rendered UNDER the app shell (they used the default layout — now `layout: false`). The curl-level checks all passed while these were broken — only the browser showed them.

## VERIFIED automated + live browser (2026-08-19, hosted worktree on :3100 at ff489bc17)

- **Unit family:** 5 files / 37 tests, twice pre-fix and once post-fix, identical counts, clean env (`env -u DATABASE_URL -u SAILOR_BETA_ALLOWLIST`). Broken-control check on the middleware guard (guard disabled ⇒ deny tests fail).
- **Local `:3000` regression:** wallet `{"mode":"local"}`; legal pages 200 (deliberate); no gate, no Clerk lookups; root 200.
- **Hosted, allowlist UNSET (default-deny):** unauthenticated `/api/wallet`, `POST /prompt`, `/api/admin/controls` → 401 (unchanged); `/terms` → 200 public. Signed in (via a Clerk sign-in token — no password typed): `/api/wallet` → **403 `beta_not_invited`** and the gate screen renders with the account email, working Sign out, legal links. The operator's own account was denied — default-deny proven end-to-end.
- **Hosted, allowlist set** (operator email in `.env.hosted`): wallet 200 `{mode:'hosted', available: 8993}`, pill animates, canvas opens, full app back.
- **Refusal toast:** a moderation-refusal `queue_error` (posted through the real window postMessage boundary on a real canvas) renders exactly ONE toast with the server message + Content-policy action (double-toast fixed and re-verified).
- **A REAL refusal end-to-end (the final review demanded it, rightly):** hosted mode forces DIRECT execution, so the bridge-path toast was dead code on the real path — and the first fix's detection still failed because Nitro's h3 bodies carry `error: true` (boolean). After both fixes: a real canvas submission (Veo 3.1, ~481cr cost-confirm dialog shown) with the Stage-7 kill-switch on → real `POST /prompt` → 503 → toast titled exactly "Sailor is temporarily paused" (DOM-recorded), nothing charged, then unpaused. This also live-exercised three Stage-5/7 surfaces for the first time: the admin `/api/admin/controls` kill-switch route, the cost-confirm gate, and the refusal-before-hold ordering.
- **Consent checkbox:** signed-out `/sign-up` shows Clerk's "I agree to the Terms of Service and Privacy Policy" checkbox + the Sailor legal footer; `/v1/environment` on the dev instance confirms `legal_consent_enabled: true` with both URLs.
- Evidence: `.superpowers/sdd/` task reports + progress ledger.

## NOT yet verified (honest gaps — fold into the pre-invite pass)

- **Fresh-account no-provisioning:** proving a brand-new non-listed signup gets NO user row / NO bonus ledger row needs a second account; unit tests cover the logic, the live proof is owed (Julien checklist #2).
- **`legal_accepted_at` stamp on a real signup** (config is live; the stamp on a fresh consent-checked signup is unexercised).
- The Stage 4–7 signed-in checklists remain owed as before.

## Julien's checklist (hosted :3100, or post-deploy)

1. **Gate:** remove your email from `SAILOR_BETA_ALLOWLIST` (or boot without it), sign in → the private-beta screen; restore email, restart → normal app.
2. **No free credits for strangers:** sign up with a throwaway email not on the list → gate screen; then in Neon: no `users` row, no `signup_bonus` ledger row for it. Add it to the list, revisit → provisioned with 100 credits.
3. **Consent:** fresh sign-up requires the checkbox; the Terms/Privacy links open your real pages.
4. **Refusal notice:** with `OPENAI_API_KEY` set, submit an obviously violating prompt → one toast citing content moderation + Content policy button, nothing charged.
5. **Legal pages** read them once — they are honest drafts of how the product actually works; correct anything that reads wrong before inviting.

## Deploy notes

See [stage8-deploy-notes](2026-08-19-stage8-deploy-notes.md): set `SAILOR_BETA_ALLOWLIST` as a Fly secret BEFORE first boot (unset = everyone locked out — safe but confusing), and re-run the Clerk legal-consent config against the production instance with real-domain URLs.

## Riders

- Final-review triage (non-blocking, carried): beta email memo is process-lifetime — a user who CHANGES their Clerk primary email sees stale allow/deny until restart (add a TTL pre-scale); `fetchPrimaryEmail` falls back to `emails[0]` without a verified-status check (deny-on-dangling-primary would be stricter); the dev-only `/ws` proxy authenticates the session but skips the allowlist (no spend path over it; revisit with production WS auth); refusal toasts depend on VueNodeCanvas being mounted if the bridge ever queues in hosted (currently impossible).
- The gate has no un-gate without a reload (re-invited account: reload once) — accepted.
- Layout opt-out is now the rule for standalone pages (legal, auth) — a future standalone page should copy `definePageMeta({ layout: false })`.
- Direct-execution refusals (non-bridge path, `default.vue:1037`) still show the generic "Couldn't start run" with the server message inside — acceptable; unify post-beta.
- Beta emails live only in gitignored env + Fly secrets — never commit them.

## Teardown

Hosted :3100 still running from `/private/tmp/claude-501/sailor-meter-verify` (kill via `lsof -nP | awk '/sailor-meter-verify/ {print $2}' | sort -u`). The browser-pane Clerk session was signed out.
