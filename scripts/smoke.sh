#!/bin/sh
set -eu

port=18787
base="http://127.0.0.1:$port"
tmp="$(mktemp -d /tmp/peer-drop-smoke.XXXXXX)"
server_pid=''

cleanup() {
  if [ -n "$server_pid" ]; then
    kill -- "-$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

# Give the server and its children their own process group for cleanup.
set -m
cf dev --mode smoke >"$tmp/cf.log" 2>&1 &
server_pid=$!
set +m

i=0
until curl -fs "$base/api/healthz" >"$tmp/health"; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    sed -n '1,200p' "$tmp/cf.log"
    exit 1
  fi
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    sed -n '1,200p' "$tmp/cf.log"
    exit 1
  fi
  sleep 1
done
test "$(cat "$tmp/health")" = 'ok'

code=$(curl -fsS -X POST "$base/api/room")
printf '%s\n' "$code" | grep -Eq '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$'

test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'test-offer' "$base/api/room/$code/offer")" = '200'
test "$(curl -fsS "$base/api/room/$code/offer")" = 'test-offer'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'replacement-offer' "$base/api/room/$code/offer")" = '409'
test "$(curl -fsS "$base/api/room/$code/offer")" = 'test-offer'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'test-answer' "$base/api/room/$code/answer")" = '200'
test "$(curl -fsS "$base/api/room/$code/answer")" = 'test-answer'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'replacement-answer' "$base/api/room/$code/answer")" = '409'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'missing' "$base/api/room/IIII/offer")" = '404'

test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/IIII/turn")" = '404'
turn_status=$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/$code/turn")
test "$turn_status" = '200' || test "$turn_status" = '503'
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/turn")" = '404'

test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/test/offer")" = '404'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "$base/api/room/$code/offer")" = '405'
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room")" = '405'

dd if=/dev/zero of="$tmp/oversize" bs=65537 count=1 2>/dev/null
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data-binary @"$tmp/oversize" "$base/api/room/$code/offer")" = '413'

expiry_code=$(curl -fsS -X POST "$base/api/room")
curl -fsS -X POST --data 'expires' "$base/api/room/$expiry_code/offer" >/dev/null
sleep 6
test "$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/$expiry_code/offer")" = '404'
test "$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data 'late-answer' "$base/api/room/$expiry_code/answer")" = '404'

i=0
read_status=''
while [ "$i" -lt 130 ]; do
  read_status=$(curl -sS -o /dev/null -w '%{http_code}' "$base/api/room/$code/answer")
  if [ "$read_status" = '429' ]; then break; fi
  i=$((i + 1))
done
test "$read_status" = '429'

echo 'smoke ok'
