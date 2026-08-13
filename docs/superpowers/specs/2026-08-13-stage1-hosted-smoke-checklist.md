# Stage 1 hosted smoke test — run-book

**Plain summary:** boot Sailor in hosted mode on this machine, sign in as the
first real user, and watch the wallet appear with the 200-credit welcome
bonus. This is the proof that Clerk, the auth middleware, user sync, and the
Neon ledger all work end to end.

**Status 2026-08-13:** steps 1–3 (the automated preconditions) were run and
verified by the controller during the Stage 1 build — a hosted server is
ALREADY RUNNING on port 3100 at commit `7feedadef` (from a worktree at
`/private/tmp/claude-501/sailor-hosted-smoke`, so the daily local server on
:3000 is untouched). The final whole-branch review found and fixed one
Critical (middleware ordering silently killed the authenticated path — the
guard now verifies sessions itself via `@clerk/backend`), re-verified live,
verdict READY. **SMOKE COMPLETE 2026-08-13 ~23:51 UTC:** Julien signed in as the first real user — Neon shows the users row, a 200-credit wallet, and exactly one signup_bonus ledger entry with the right idempotency key. Email is NULL on the user row as predicted (webhook leg deferred; lazy sync has no email). Steps 4–8 done; only the webhook leg (step 9) remains, deferred to deployment.

**Debug tip (from the final review):** the guard fails closed — bad keys, a
Clerk outage, or a JWKS fetch failure all look like a 401, not a 5xx. If
step 6 401s persistently after a successful sign-in, check the :3100 boot
log for Clerk errors before debugging the auth flow. An expired session
hitting an API path also 401s until a page reload lets Clerk refresh it.

## One-time setup (VERIFIED — already done, server left running)

1. Hosted server from an isolated worktree (never a second server in the main
   checkout — two dev servers share `.nuxt` and corrupt each other):

```bash
git worktree add --detach /private/tmp/claude-501/sailor-hosted-smoke HEAD && ln -s "$PWD/frontend/node_modules" /private/tmp/claude-501/sailor-hosted-smoke/frontend/node_modules && cd /private/tmp/claude-501/sailor-hosted-smoke/frontend && env $(grep -vE '^#|^$' /Users/julien/Documents/GitHub/Sailor/frontend/.env.hosted | xargs) ./node_modules/.bin/nuxt dev --port 3100
```

   (Note: `./node_modules/.bin/nuxt dev` directly, NOT `npm run dev` — the
   `predev` embed build fails in a fresh worktree because `.nuxt/tsconfig.json`
   doesn't exist yet.)

2. Hosted mode armed — **verified:** `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/api/wallet` → `401` (not `{"mode":"local"}`).
3. Engine paths guarded — **verified:** `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:3100/prompt` → `401`. Sign-in page renders with Clerk state serialized (`clerk-initial-state` present in SSR HTML) — **verified**, and the local :3000 server still returns `{"mode":"local"}` — **verified**.

## The smoke (Julien)

4. Open http://127.0.0.1:3100/sign-in — the Clerk widget should render (Email + Google).
5. Sign up with your email. Expect redirect + a session.
6. Visit http://127.0.0.1:3100/account — expect **200 available · 200 total** (signup bonus via lazy sync; the bonus amount is provisional pending the pricing call).
7. In the Neon console → Tables → `users`: your Clerk user id row exists (email arrives via webhook later; the lazy sync path may leave it null until then — that's expected).
8. In the Clerk dashboard → Users: the same user.

## Webhook leg (optional now, required before launch)

9. Clerk dashboard → Webhooks: add an endpoint (needs a public URL — defer to
   the deployed environment or use a tunnel), subscribe to `user.created`, set
   `CLERK_WEBHOOK_SIGNING_SECRET` in the hosted env. Until then, the lazy
   first-request sync covers user creation (idempotent — both can fire).

## Teardown (when done)

```bash
pkill -f "sailor-hosted-smoke/frontend" ; git worktree remove --force /private/tmp/claude-501/sailor-hosted-smoke
```

The daily local server on :3000 is never touched by any of this.
