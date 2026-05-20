#!/usr/bin/env bash
# Smoke test for `huu --web`.
#
# Boots the server on a fixed port (so we don't need to scrape stderr
# for the URL) and asserts that the auth gate is active: a request
# without the per-process token must return 401.
#
# The token is unknown to this script, which is the point — proving
# the 401 gate is the proof the server is wired up correctly.

set -euo pipefail

PORT="${HUU_TEST_PORT:-45678}"
NPM_BIN="${NPM_BIN:-npm}"

cleanup() {
  if [ -n "${PID:-}" ]; then
    kill "$PID" 2>/dev/null || true
    # Give the process a moment to exit cleanly before SIGKILL.
    sleep 0.5
    kill -9 "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

export HUU_WEB_NO_OPEN=1

# Use --stub so no real LLM SDK is loaded, --yolo to satisfy the
# Phase-1 gate, --no-open as belt-and-suspenders alongside the env var.
"$NPM_BIN" start --silent -- \
  --web --stub --yolo \
  --web-port="$PORT" --no-open \
  >/dev/null 2>smoke-web.stderr.log &
PID=$!

# Wait up to ~10s for the listener to come up.
ready=0
for _ in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/" || true)
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    ready=1
    break
  fi
  sleep 0.25
done

if [ "$ready" -ne 1 ]; then
  echo "smoke-web: server never came up on port $PORT" >&2
  echo "--- stderr ---" >&2
  cat smoke-web.stderr.log >&2 || true
  exit 1
fi

code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/")
if [ "$code" != "401" ]; then
  echo "smoke-web: expected 401 without token, got $code" >&2
  echo "--- stderr ---" >&2
  cat smoke-web.stderr.log >&2 || true
  exit 1
fi

# Sanity: the URL printed to stderr should be on the requested port.
if ! grep -q "huu web UI ready: http://127.0.0.1:$PORT/?t=" smoke-web.stderr.log; then
  echo "smoke-web: expected 'huu web UI ready:' line with port $PORT in stderr" >&2
  cat smoke-web.stderr.log >&2 || true
  exit 1
fi

rm -f smoke-web.stderr.log
echo "smoke-web: OK"
