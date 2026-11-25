#!/usr/bin/env bash
# Run the billing job on the local portal: send queued emails to the dev outbox, queue the trial
# and late payment reminders, and run what is due for the test subscriptions.
#
#   deploy/dev/billing-tick.sh          run it once and print the report
#   deploy/dev/billing-tick.sh watch    run it every 15 seconds until you press Ctrl C
#
# In production Vercel Cron calls the same route once a minute (apps/portal/vercel.json).
# Locally nothing calls it by itself, so reminders only go out when you run this. Opening
# http://localhost:3300/dev/outbox also delivers waiting emails, so codes show up without it.
#
# It only ever talks to the local portal. If your .env.local sets CRON_SECRET, export the same
# value before you run this and it is sent as the bearer token.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PORTAL_PORT="$(app_port portal)"
URL="http://localhost:$PORTAL_PORT/api/billing/jobs/tick"
MODE="${1:-once}"
INTERVAL="${KITSTAK_TICK_SECONDS:-15}"

case "$MODE" in
  once | watch) ;;
  *) echo "Usage: deploy/dev/billing-tick.sh [watch]" >&2; exit 2 ;;
esac

tick() {
  local body code args=(-s -m 120 -X POST -w '\n%{http_code}')
  [ -n "${CRON_SECRET:-}" ] && args+=(-H "Authorization: Bearer $CRON_SECRET")
  if ! body="$(curl "${args[@]}" "$URL" 2>/dev/null)"; then
    echo "$(date +%H:%M:%S)  no answer from $URL  (start the portal: deploy/dev/app-start.sh portal)"
    return 1
  fi
  code="${body##*$'\n'}"
  body="${body%$'\n'*}"
  case "$code" in
    200) echo "$(date +%H:%M:%S)  $body" ;;
    401) echo "$(date +%H:%M:%S)  401: the portal has a CRON_SECRET. Export the same value and run again."; return 1 ;;
    *) echo "$(date +%H:%M:%S)  HTTP $code  $body"; return 1 ;;
  esac
}

if ! port_open "$PORTAL_PORT"; then
  echo "The portal is not running on port $PORTAL_PORT. Start it: deploy/dev/app-start.sh portal" >&2
  exit 1
fi

if [ "$MODE" = "once" ]; then
  tick
  exit $?
fi

echo "Running the billing job every ${INTERVAL}s. Press Ctrl C to stop."
trap 'echo; echo "Stopped."; exit 0' INT TERM
while :; do
  tick || true
  sleep "$INTERVAL"
done
