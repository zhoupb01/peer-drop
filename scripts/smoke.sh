#!/bin/sh
set -eu

port=18787
base="http://127.0.0.1:$port"
tmp="$(mktemp -d /tmp/peer-drop-smoke.XXXXXX)"
server_pid=''

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

wrangler dev --local --port "$port" --var ROOM_TTL_MS:200 \
  --show-interactive-dev-session=false >"$tmp/wrangler.log" 2>&1 &
server_pid=$!

i=0
until curl -fs "$base/api/healthz" >"$tmp/health"; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    sed -n '1,200p' "$tmp/wrangler.log"
    exit 1
  fi
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    sed -n '1,200p' "$tmp/wrangler.log"
    exit 1
  fi
  sleep 1
done
test "$(cat "$tmp/health")" = 'ok'

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'test-offer' "$base/api/room/TEST/offer")" = '200'
test "$(curl -fsS "$base/api/room/TEST/offer")" = 'test-offer'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'test-answer' "$base/api/room/TEST/answer")" = '200'
test "$(curl -fsS "$base/api/room/TEST/answer")" = 'test-answer'
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/test/offer")" = '404'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$base/api/room/TEST/offer")" = '405'

dd if=/dev/zero of="$tmp/oversize" bs=65537 count=1 2>/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data-binary @"$tmp/oversize" "$base/api/room/BIGG/offer")" = '413'

curl -fsS -X POST --data 'expires' "$base/api/room/EXPR/offer" >/dev/null
sleep 1
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/EXPR/offer")" = '404'

echo 'smoke ok'
