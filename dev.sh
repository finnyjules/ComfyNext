#!/usr/bin/env bash
# Local dev launcher for Sailor.
#
# Starts the two servers that make up the app on PINNED ports and guarantees
# there's exactly one clean pair — no ghosts:
#   - ComfyUI backend (MPS) on :8188   ← the canvas iframe connects here
#   - Nuxt frontend            on :3000   ← what you open in the browser
#
# "Kill & take over": on start it frees both ports first, and on exit (Ctrl-C
# or either process dying) it reaps BOTH servers and any children holding the
# ports. Quitting never leaves orphans behind.
#
# Usage:
#   ./dev.sh            start both (default)
#   ./dev.sh status     show what's on the two ports
#   ./dev.sh stop       kill whatever is on the two ports and exit
#
# This is the LOCAL launcher. start.sh is the production/Fly.io one — different
# ports paths and flags; don't use it locally.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMFY_PORT=8188
FRONTEND_PORT=3000
PY="$ROOT/.venv/bin/python"

port_pids() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true; }

kill_port() {
  local port=$1 pids
  pids=$(port_pids "$port")
  [ -z "$pids" ] && return 0
  echo "[dev] freeing :$port (killing $pids)"
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  pids=$(port_pids "$port")
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

status() {
  for p in "$COMFY_PORT" "$FRONTEND_PORT"; do
    local pids; pids=$(port_pids "$p")
    if [ -n "$pids" ]; then echo "[dev] :$p  LISTEN  (pid $pids)"; else echo "[dev] :$p  free"; fi
  done
}

case "${1:-start}" in
  status) status; exit 0 ;;
  stop)   kill_port "$COMFY_PORT"; kill_port "$FRONTEND_PORT"; echo "[dev] stopped."; exit 0 ;;
  start)  ;;
  *)      echo "usage: ./dev.sh [start|stop|status]"; exit 2 ;;
esac

# --- pre-flight: take over the ports so we always land on 8188 + 3000 ---
kill_port "$COMFY_PORT"
kill_port "$FRONTEND_PORT"

COMFY_PID=""; FRONTEND_PID=""
cleanup() {
  echo
  echo "[dev] shutting down..."
  [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
  [ -n "$COMFY_PID" ]    && kill "$COMFY_PID"    2>/dev/null || true
  # nuxt/vite spawn children that outlive the parent — reap them by port.
  kill_port "$FRONTEND_PORT"
  kill_port "$COMFY_PORT"
  wait 2>/dev/null || true
  echo "[dev] done."
}
trap cleanup EXIT
trap 'exit 130' INT TERM

echo "[dev] starting ComfyUI  on :$COMFY_PORT ..."
( cd "$ROOT" && exec "$PY" main.py --listen 127.0.0.1 --port "$COMFY_PORT" --disable-auto-launch ) &
COMFY_PID=$!

echo "[dev] starting frontend on :$FRONTEND_PORT ..."
( cd "$ROOT/frontend" && exec pnpm dev --port "$FRONTEND_PORT" --host 127.0.0.1 ) &
FRONTEND_PID=$!

echo "[dev] ComfyUI  → http://127.0.0.1:$COMFY_PORT"
echo "[dev] frontend → http://127.0.0.1:$FRONTEND_PORT"
echo "[dev] Ctrl-C to stop both."

# If either server exits, tear the other down (the EXIT trap does the reaping).
# Poll rather than `wait -n`: macOS ships bash 3.2, which lacks `wait -n`.
while kill -0 "$COMFY_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
echo "[dev] a server exited — stopping the other."
