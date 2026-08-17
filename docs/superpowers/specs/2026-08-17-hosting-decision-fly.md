# Hosting decision — Fly.io (sjc), auto-stop by default

**Plain summary:** Sailor's hosted box will run on Fly.io in San Jose, configured so the machine goes to sleep when nobody is using it. An idle month costs a dollar or two of disk, not $30 of forgotten compute — that exact surprise bill is why auto-stop is the default, and always-on becomes a deliberate flip for the beta week. Railway and Hetzner were compared with fresh (Aug 2026) numbers and lost.

## The decision

- **Platform:** Fly.io. **Region:** `sjc` (San Jose — nearest to Neon in aws-us-west-2/Oregon).
- **Config:** `auto_stop_machines = "stop"`, `min_machines_running = 0` — see fly.toml. Flip to always-on only for the beta window, explicitly.
- **Sizing:** `shared-cpu-4x` @ 8GB + ~100GB volume. Estimated ~$63/mo always-on; ~$1–2/mo idle.
- The old scaffold app was deleted by Julien (it billed ~$30 for an idle month — the default config never stops machines). App gets recreated at deploy time; the fly.toml app name is a placeholder until then.

## Why (comparison, researched 2026-08-17 from official pricing pages)

| | Fly.io | Railway | Hetzner US |
|---|---|---|---|
| ~4vCPU/8GB + 100GB disk + 200GB egress, 24/7 | **~$63/mo** (shared) | ~$185/mo | ~$74/mo flat (CPX31) |
| Idle month | **~$1–2** (auto-stop) | full compute price | full flat price |
| Region vs Neon Oregon | sjc/lax | us-west2 (CA) | Hillsboro OR (same metro) |
| Ops burden | flyctl + existing scaffold | lowest | full self-managed VM |
| Reliability (trailing yr) | wobbly (~17 status incidents/30d Aug 2026) | worst: 8h full outage May 2026 (GCP account suspension) + cryptominer incident | boring, but you are the SRE |

- **Hetzner's US cheapness is gone:** June 2026 repricing raised US locations ~+194% (CPX31 $24.99 → $73.49). Its remaining edges (flat bill, 1TB included traffic, Neon-adjacent Hillsboro) don't outweigh Fly's lower cost + zero-idle-cost + existing scaffold. It stays the graduation path if Fly's bills or incidents annoy post-beta — the Dockerfile makes migration an afternoon.
- **Railway eliminated:** ~3× compute cost for always-on plus the ugliest reliability year of the three; its DX edge is irrelevant when deploys are Claude-driven.
- **Fly's incident frequency is the accepted risk:** fine for a watched 5-person beta; all money-state lives in Neon, the box holds only replaceable media until R2.

## Deploy-day checklist (when the deployment stage runs)

1. `flyctl launch` fresh app (name TBD — old one deleted), region sjc, create the volume, import secrets from `frontend/.env.hosted` via `flyctl secrets` (never commit).
2. **Production WS auth** — the Task-7 `/ws` auth lives in the dev-server hook and does not exist in built Nitro. Ship either a crossws session-checked proxy route or Caddy `forward_auth` against a small Nitro session-check endpoint before any public deploy. Hosted WS must not ship unauthenticated.
3. Stage 5 deploy preconditions (verification doc): empty engine `input/` dir or backfill `input_uploads`; `SAILOR_ENGINE_ROOT` if processes don't launch from `frontend/`; never set `NUXT_PUBLIC_COMFY_ORIGIN`; never expose :8188.
4. Clerk: switch dev instance → production instance keys at real-domain time; webhook leg activates here.
5. Authenticated-`/ws` positive probe + the full Stage-5 hosted probe set against the deployed URL.
