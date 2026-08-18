#!/usr/bin/env bash
set -euo pipefail

# Runtime dirs live on the Fly volume mounted at /data so generated outputs,
# uploads, and user settings/workflows persist across deploys.
mkdir -p /data/output /data/input /data/temp /data/user

# Persist the model stores (per-user characters, LoRAs, voices + the training-
# jobs ledger) on the Fly volume. The container's own disk is EPHEMERAL — every
# redeploy ships a fresh image, so without this every user-trained LoRA, cloned
# voice, and cast character written under /app/models/ would vanish on deploy.
# Only runs when the volume is mounted (/data present); local/dev boxes have no
# /data and keep the repo's models/ dir exactly as-is (byte-identical). Must run
# BEFORE ComfyUI starts, since it also reads models/ (loras, etc.).
if [ -d /data ]; then
  mkdir -p /data/models/characters /data/models/loras /data/models/voices
  for d in characters loras voices; do
    # First boot: seed the volume with any curated content baked into the image
    # (operator-seeded LoRAs/characters ship read-only for everyone), then hand
    # the repo path to the volume via a symlink so all future writes land on
    # /data. On later boots /app/models/$d is already a symlink, so we skip the
    # seed and just re-point (ln -sfn is idempotent).
    if [ -d "/app/models/$d" ] && [ ! -L "/app/models/$d" ]; then
      cp -an "/app/models/$d/." "/data/models/$d/" 2>/dev/null || true
      rm -rf "/app/models/$d"
    fi
    ln -sfn "/data/models/$d" "/app/models/$d"
  done
  # The training-jobs ledger is a single file — persist it the same way.
  if [ -f /app/models/.training-jobs.json ] && [ ! -L /app/models/.training-jobs.json ]; then
    cp -an /app/models/.training-jobs.json /data/models/.training-jobs.json 2>/dev/null || true
    rm -f /app/models/.training-jobs.json
  fi
  touch /data/models/.training-jobs.json
  ln -sfn /data/models/.training-jobs.json /app/models/.training-jobs.json
fi

# 1) ComfyUI backend (CPU-only) on :8188.
cd /app
python main.py \
  --listen 0.0.0.0 --port 8188 \
  --cpu --disable-auto-launch \
  --output-directory /data/output \
  --input-directory /data/input \
  --temp-directory /data/temp \
  --user-directory /data/user \
  --database-url "sqlite:////data/comfyui.db" &
COMFY_PID=$!

# 2) Nuxt (Nitro) server on :3000. cwd MUST be /app/frontend so the
#    /api/loras-local route resolves ../models/loras correctly.
cd /app/frontend
node .output/server/index.mjs &
NUXT_PID=$!

# If either process dies, bring the whole container down so Fly restarts it.
wait -n "$COMFY_PID" "$NUXT_PID"
echo "[start.sh] a process exited; shutting down container." >&2
kill "$COMFY_PID" "$NUXT_PID" 2>/dev/null || true
exit 1
