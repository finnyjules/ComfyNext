# Stage 8 — private-beta launch surfaces: design

**Plain summary:** the smallest set of surfaces needed to safely invite the five beta users, in three pieces. (1) A guest list: only the five email addresses on a server-side list can use the hosted app — anyone else who signs up gets no wallet, no free credits, and a polite "Sailor is in private beta" screen, so a stranger who finds the URL cannot spend provider money. The list defaults to *nobody* — if it is empty, no one gets in. (2) Legal cover: Terms, Privacy, and Content Policy pages (drafted as beta starters, flagged for a real legal read before public launch) plus a consent checkbox at sign-up that records acceptance. (3) Clear refusals: when the server refuses a generation — blocked prompt, out of credits, system paused — the canvas shows the human-readable reason instead of a raw error. Explicitly deferred: the public marketing landing page and any rich account/billing UI. Local mode is byte-identical throughout, as in every hosted stage.

**Scope:** private beta for the five watched practitioners — NOT a public launch. Sequencing note (recorded): these surfaces can be built now, but the actual invites go out only after the owed signed-in checklists + the Fly deploy prove the real paid flow.

## Global constraints (same as every hosted stage)

- No `NUXT_CLERK_SECRET_KEY` ⇒ local mode ⇒ byte-identical. Every new behavior gated on hosted mode or env presence. Local `:3000` regression is part of final verification.
- The allowlist and any new keys live ONLY in gitignored `frontend/.env.hosted` (and Fly secrets at deploy); beta users' emails are never committed.
- Fail direction: access control fails CLOSED (unreadable list or failed email lookup ⇒ deny) — same rationale as the spend guard: an unknown access state is a money risk.
- No commas in trailing comments on `export const` lines under `frontend/server/`.

## Component A — beta access allowlist (the spend-hole fix)

**What:** `SAILOR_BETA_ALLOWLIST` — a comma-separated list of email addresses (case-insensitive, trimmed) in the hosted env. In hosted mode, a signed-in user whose primary email is not on the list is refused everything and is never provisioned.

**Why it must exist:** today any stranger who signs up through Clerk gets a user row + wallet + 100 free credits (≈ $0.65 real provider exposure each, unbounded signups) the moment they touch the app. The Stage-7 valves bound total damage but do not close the door.

**Enforcement points (both bonus-grant paths):**
- **Auth middleware** (`server/middleware/auth.ts`) — the chokepoint every API/proxy request passes through. After the session resolves a userId, resolve the user's email and check the list. Not listed ⇒ `403 { code: 'beta_not_invited' }` AND skip the lazy `ensureUserWithBonus` call — no user row, no wallet, no bonus. The middleware today has only the userId, so the email comes from one memoized-per-process Clerk `users.getUser` lookup per user (misses are cheap; restarts re-fetch). A failed lookup denies (fail closed).
- **Clerk webhook** (`user.created`) — skip `sync` for a non-listed email, so the webhook path cannot provision either. When a user is later added to the list, the lazy middleware path provisions them on their next request — no re-signup needed.

**Default-deny:** in hosted mode an unset/empty `SAILOR_BETA_ALLOWLIST` means *nobody* passes. This is deliberate: forgetting to configure the list on a deploy must fail safe, not open. (Operational consequence, recorded: hosted dev on `:3100` needs Julien's email in `.env.hosted` from this stage on.)

**Frontend gate screen:** a signed-in-but-not-invited user's first wallet fetch returns the 403; the app shows a full-screen "Sailor is in private beta" notice — the signed-in email, one line of copy, a sign-out button. No waitlist form, no email capture (YAGNI for 5 invites). Unauthenticated behavior is unchanged (401s / sign-in page as today).

**Local mode:** the variable is ignored entirely; no email lookups, no gate, byte-identical.

## Component B — legal pages + consent at sign-up

**Pages:** `/terms`, `/privacy`, `/content-policy` — three static Nuxt pages, plain readable prose, linked from the sign-up card and the gate screen footer. Drafted content covers the real facts of the product: credits are prepaid and expire, prices are repriceable, it is a beta with no uptime/warranty promise, users own their outputs and are responsible for their prompts, prohibited content (mirrors the moderation categories), what is stored (account email, generation records, uploaded assets, ledger) and the processors involved (Clerk, Stripe, Neon, Sentry, the generation providers). Each page carries a visible "beta draft — will be reviewed by counsel before public launch" note. These are starter documents, not legal advice — recorded.

**Consent:** use Clerk's built-in legal-acceptance feature — it adds a required "I agree to the Terms & Privacy Policy" checkbox to the existing `<SignUp/>` widget (pointed at `/terms` + `/privacy`) and stores an acceptance timestamp on the Clerk user. Configured via the Clerk API/CLI as a scripted, documented deploy step. **Fallback (only if the Clerk plan/API does not expose it):** a one-page Sailor-side accept interstitial — signed-in users with no recorded acceptance are routed to it once; acceptance (version + timestamp) stored in Neon. The fallback is a design reserve, not a second implementation to build speculatively.

**No onboarding flow (decided):** after sign-in, users land on the homepage/canvas as normal. The what-are-credits explanation lives in the Terms page, not a welcome wizard.

## Component C — refusal surfacing on the canvas

**What:** when the canvas graph submission (`POST /prompt`) is refused by the metering chokepoint, the user sees the server's human-readable reason as a canvas notice/toast instead of a silent failure or raw error. One channel covers the whole refusal family (`MeterRefusalError` already carries clean messages): "This prompt was blocked by content moderation" (400), "insufficient credits" (402), file-ownership refusals (403), "temporarily paused" (503).

**How:** the submit path runs through the ComfyUI iframe/bridge, so the refusal must cross the postMessage boundary: catch the non-2xx `/prompt` response where it is made, forward `{ statusCode, message }` to the Vue side, render as a dismissible notice near the prompt bar/canvas. Moderation refusals get one extra line ("check our content policy" linking `/content-policy`). Local mode: the chokepoint never refuses in local, so the notice simply never fires — no gating needed beyond what exists.

**Not in scope:** retry UX, appeal flow, per-category moderation explanations (deferred; fine for watched users).

## Deferred (recorded, not forgotten)

- **Public marketing landing page** — deferred to the public-launch stage; the five are hand-invited by URL.
- **Rich account/billing UI, transaction history** — `account.vue` stays minimal; the ledger already records everything for a later UI.
- **Waitlist/invite-request capture** on the gate screen — YAGNI for 5 invites.
- **Counsel review of the legal drafts** — REQUIRED before public launch; explicitly not blocking a 5-known-user beta.

## Verification

- RED-first for: the allowlist parse/check util, both enforcement points (middleware deny + webhook skip), and default-deny on empty list.
- Hosted probes: non-listed signed-in user → 403 + no wallet row + no ledger bonus; listed user → provisioned exactly as today; unauthenticated → 401 unchanged.
- Local `:3000` regression: no Clerk lookups, no gate, legal pages render (they are public static pages in both modes — harmless locally), byte-identical behavior elsewhere.
- Browser check: gate screen renders for a non-listed account; consent checkbox appears at sign-up; a moderation-refused prompt shows the canvas notice.

