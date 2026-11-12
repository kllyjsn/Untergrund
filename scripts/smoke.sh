#!/usr/bin/env bash
# Boots server.mjs with SC_MOCK=1 and checks the app plus key /api endpoints respond.
set -euo pipefail
PORT="${PORT:-8020}"
BASE="http://localhost:$PORT"
LOG="$(mktemp)"
SC_MOCK=1 PORT="$PORT" node server.mjs >"$LOG" 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 50); do
  curl -s -o /dev/null "$BASE/" && break
  if ! kill -0 "$PID" 2>/dev/null; then cat "$LOG"; exit 1; fi
  sleep 0.1
done

fail=0
check() {
  local want="$1" path="$2" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  if [ "$got" = "$want" ]; then echo "ok   $got $path"; else echo "FAIL $got $path (want $want)"; fail=1; fi
}

check 200 /
check 200 /js/main.js
check 200 /css/style.css
check 200 /embed.html
check 200 /manifest.webmanifest
check 200 /sw.js
check 200 /js/pwa.js
check 200 /icons/icon-192.png
check 200 /icons/icon-512.png
check 200 /icons/icon-maskable-512.png
check 200 /icons/apple-touch-icon.png
check 200 /samples/live/kick_v2_1.flac
check 404 /samples/live/kick_v2_1.wav
check 200 /api/sc-config
check 200 /api/room-config
check 200 /api/tracks
check 200 "/api/tracks?drop=2026-11-03"
check 400 "/api/tracks?drop=nope"
check 405 "/api/tracks?play=missing-track"
check 200 /js/daily.js
check 200 /js/push.js
check 200 /api/push
check 401 "/api/push?send=1"
check 200 /css/drop.css
check 200 /api/jukebox
check 404 "/api/jukebox?id=no-such-set"
check 200 /api/account
check 404 /a/nobody-here
check 404 /t/missing-track
check 200 /css/pages.css
check 200 /api/events
check 401 "/api/events?summary=1&token=wrong"
check 200 "/api/events?summary=1&token=dev"
check 200 /stats.html
check 200 "/api/rooms/ci-smoke?since=0"
check 404 /api/does-not-exist
check 404 /api/tracks.js

if [ "$fail" != 0 ]; then echo "--- server log"; cat "$LOG"; exit 1; fi
echo "smoke test passed"
