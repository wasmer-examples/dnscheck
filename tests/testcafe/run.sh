#!/usr/bin/env bash
set -euo pipefail

uv run python ./src/main.py &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process terminated before becoming ready" >&2
    exit 1
  fi
  if curl -sf "http://127.0.0.1:8000" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:8000" >/dev/null; then
  echo "Server did not become ready in time" >&2
  exit 1
fi

npx testcafe chrome tests/testcafe/dnscheck.test.js
