#!/usr/bin/env bash
set -euo pipefail

# Runtime dirs live on the Fly volume mounted at /data so generated outputs,
# uploads, and user settings/workflows persist across deploys.
mkdir -p /data/output /data/input /data/temp /data/user

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
