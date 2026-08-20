# Stage 8 deploy notes — Clerk legal-acceptance consent + beta allowlist

**Plain summary:** Sign-up on Sailor's Clerk DEV instance now requires a "I agree to the Terms of Service and Privacy Policy" checkbox before an account can be created, pointing at the local `/terms` and `/privacy` pages from Task 5 (`http://127.0.0.1:3100/terms` and `/privacy`). This is a Clerk instance-config toggle, not app code — no feature is gated behind a paid plan, the `clerk-cli` dry-run and live PATCH both went through cleanly on the free/dev tier. This doc records the exact calls made so the same change can be re-run against the production instance and real domain at deploy time, plus the one Fly secret (`SAILOR_BETA_ALLOWLIST`) that must be set before the app's first boot or every sign-in gets refused.

## What changed (DEV instance `ins_3Hs5Zb29wlvttLPE8v2NyPOkJIJ`, app `app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb` "Sailor")

Clerk exposes this as `compliance.legal_consent` in instance config (not the `legal_terms_url`/`legal_privacy_policy_url` fields on `PATCH /v1/instance` — that shape is stale; the live schema via `clerk config schema` puts it under `compliance.legal_consent` with `enabled` / `terms_of_service_url` / `privacy_policy_url`).

**Before:**
```json
{
  "compliance": {
    "legal_consent": {
      "enabled": false,
      "privacy_policy_url": null,
      "terms_of_service_url": null
    }
  }
}
```

**After:**
```json
{
  "compliance": {
    "legal_consent": {
      "enabled": true,
      "privacy_policy_url": "http://127.0.0.1:3100/privacy",
      "terms_of_service_url": "http://127.0.0.1:3100/terms"
    }
  }
}
```

## Exact commands run (dev)

```bash
# 0. Health check
clerk doctor --json

# 1. Discovery — find the current instance config and the field shape
clerk config pull --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb > config-before.json
clerk config schema --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb > config-schema.json
# → compliance.legal_consent = { enabled: false, privacy_policy_url: null, terms_of_service_url: null }

# 2. Patch payload (legal-consent-patch.json)
cat > legal-consent-patch.json <<'EOF'
{
  "compliance": {
    "legal_consent": {
      "enabled": true,
      "privacy_policy_url": "http://127.0.0.1:3100/privacy",
      "terms_of_service_url": "http://127.0.0.1:3100/terms"
    }
  }
}
EOF

# 3. Preview, then apply
clerk config patch --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb --file legal-consent-patch.json --dry-run
clerk config patch --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb --file legal-consent-patch.json --yes

# 4. Verify — re-pull config, and hit the Frontend API environment endpoint
#    (this is literally what clerk-js on :3100 reads to draw the sign-up card)
clerk config pull --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb
clerk api --fapi /environment --instance dev --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb
```

Auth used the CLI's own resolved credentials for the linked app (`clerk link` had already bound this repo to app `app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb` via the git remote); no key was echoed to stdout or written into this doc. The CLI's `Authentication valid` doctor check failed (dashboard OAuth token expired) but Backend/Config API calls against the linked app succeeded regardless — that check gates the interactive dashboard login, not per-app API auth. If reproducing this without a working `clerk` CLI, use the Backend secret key from `frontend/.env.hosted`'s `NUXT_CLERK_SECRET_KEY` with the same `config`/`api` payloads shown above, e.g.:
```bash
export CLERK_SECRET_KEY=$(grep -oP '(?<=NUXT_CLERK_SECRET_KEY=).*' frontend/.env.hosted)
curl -s -H "Authorization: Bearer $CLERK_SECRET_KEY" https://api.clerk.com/v1/instance # never echo $CLERK_SECRET_KEY
```

## Verification evidence (dev, 2026-08-19)

- `clerk config pull` after the patch shows `compliance.legal_consent.enabled: true` with both URLs set, matching the "After" block above.
- `clerk api --fapi /environment` (the same endpoint clerk-js fetches to render the sign-up card at `:3100`) returned:
  - `user_settings.sign_up.legal_consent_enabled: true`
  - `display_config.terms_url: "http://127.0.0.1:3100/terms"`
  - `display_config.privacy_policy_url: "http://127.0.0.1:3100/privacy"`
- `clerk users list` against the dev instance confirms the user object carries a `legal_accepted_at` field (`null` on an existing user who signed up before this change went live, as expected — it stamps only on future consenting sign-ups).
- The hosted dev server on `127.0.0.1:3100` was left running throughout (not restarted); a plain `curl` to `/` returned `200`.
- A live browser click-through of the sign-up card (checkbox visible, blocks submit until checked) was not run in this pass — the session lead covers the visual Browser-pane check separately.

## Step 4 stop condition — did NOT trigger

Legal-acceptance is **not** gated on a paid Clerk plan. The dry-run and live `config patch` both validated and applied cleanly on this instance's current (free/dev) plan, with no entitlement or billing error from the API at any point. No Sailor-side consent interstitial is needed as a fallback.

## Prod re-run steps (at Fly deploy time)

The production Clerk instance and the production domain do not exist yet (per `docs/superpowers/specs/2026-08-17-hosting-decision-fly.md`, the Fly app name in `fly.toml` — currently `vessell` — and the real domain are both placeholders, decided at deploy time). When they're real, repeat the same patch against `--instance prod` with the real URLs:

```bash
clerk config pull --instance prod --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb > config-before-prod.json

cat > legal-consent-patch-prod.json <<'EOF'
{
  "compliance": {
    "legal_consent": {
      "enabled": true,
      "privacy_policy_url": "https://<prod-domain>/privacy",
      "terms_of_service_url": "https://<prod-domain>/terms"
    }
  }
}
EOF

clerk config patch --instance prod --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb --file legal-consent-patch-prod.json --dry-run
clerk config patch --instance prod --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb --file legal-consent-patch-prod.json --yes

# verify against the prod Frontend API
clerk api --fapi /environment --instance prod --app app_3Hs5ZcD3mmK2Im7TXgVxuDAO0Sb
```

Replace `<prod-domain>` with the real chosen production domain (Sailor's `/terms` and `/privacy` routes from Task 5, served from that domain). This lines up with the existing deploy checklist item "Clerk: switch dev instance → production instance keys at real-domain time" in the hosting-decision doc — do the `legal_consent` patch as part of that same step, not before the domain is final (Clerk will happily store an unreachable URL, but the sign-up card would then link to nothing).

## `SAILOR_BETA_ALLOWLIST` Fly secret — set BEFORE first boot

Sailor's auth middleware (`frontend/server/middleware/auth.ts`, backed by `frontend/server/utils/betaAccess.ts`) gates every authenticated request behind a comma-separated, case-insensitive email allowlist read from `process.env.SAILOR_BETA_ALLOWLIST`. It fails **CLOSED**: an unset or empty list denies every single user, including the operator. This is intentional (an unknown access state is treated as a money risk — each stray signup lazily provisions a wallet with real bonus credits) but it means a forgotten secret doesn't fail loudly, it just locks everyone out with a 403 `beta_not_invited` — safe, but confusing to debug blind.

Set it before the very first production boot:

```bash
flyctl secrets set SAILOR_BETA_ALLOWLIST="julien@example.com,beta-tester@example.com" -a vessell
```

(replace `vessell` with the real Fly app name once `flyctl launch` names it, and use real invited emails — never commit real beta-tester emails into this doc or any tracked file; they belong only in `frontend/.env.hosted` locally and in Fly secrets remotely, per the Stage 8 plan's Component A note.)

If the app boots without this secret set, expect: every sign-in succeeds at Clerk but every subsequent app request 403s with `beta_not_invited` — that's the fail-closed default working as designed, not a bug. Setting the secret and letting the app pick up the new env (Fly secrets trigger a restart of the machine) resolves it without a redeploy.
