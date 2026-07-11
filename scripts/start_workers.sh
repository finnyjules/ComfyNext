#!/bin/bash
# Extra ComfyUI workers for the Sailor parallel-run pool.
#
# The primary server (:8188) is the one you run by hand; this starts the
# extra workers the pool round-robins project tabs across. Pair it with:
#   localStorage['sailor:pool'] =
#     'http://127.0.0.1:8188,http://127.0.0.1:8189,http://127.0.0.1:8190,http://127.0.0.1:8191,http://127.0.0.1:8192'
# in the app's browser console (set once; survives reloads). Workers that
# aren't running are probed and skipped at app load, so it's safe to start
# fewer than the list names.
#
# Logs: /tmp/sailor-worker-<port>.log
set -u
cd "$(dirname "$0")/.."

for PORT in 8189 8190 8191 8192; do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$PORT/"; then
    echo "worker :$PORT already running"
  else
    nohup .venv/bin/python main.py --listen 127.0.0.1 --port "$PORT" \
      > "/tmp/sailor-worker-$PORT.log" 2>&1 &
    echo "started worker :$PORT (pid $!)"
  fi
done
