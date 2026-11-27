#!/usr/bin/env bash
# Forward real Stripe TEST events to the local Portal, signed with the local webhook secret.
# Stripe cannot reach a Portal on this machine, so this tool fetches the events and posts them.
#
#   deploy/dev/stripe-events.sh                    forward every new event once, oldest first
#   deploy/dev/stripe-events.sh watch              the same, every 3 seconds, until Ctrl C
#   deploy/dev/stripe-events.sh status             show what is waiting. Sends nothing.
#   deploy/dev/stripe-events.sh since 30           start again from the last 30 minutes
#   deploy/dev/stripe-events.sh replay evt_1 evt_2 send these again (the Portal answers "duplicate")
#   add --reverse to send a batch newest first, --twice to send each event two times
#
# The Portal must run in real Stripe mode:  KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal
# It only reads from Stripe and only posts to http://localhost. Test mode only.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -s "$STRIPE_ENV_FILE" ] || "$DEV_DIR/stripe-env.sh"
load_stripe_env || { echo "Could not read $STRIPE_ENV_FILE" >&2; exit 1; }
export STRIPE_EVENTS_CURSOR_FILE="${STRIPE_EVENTS_CURSOR_FILE:-$RUN_DIR/stripe-events.cursor.json}"
export STRIPE_EVENTS_URL="${STRIPE_EVENTS_URL:-http://localhost:$(app_port portal)/api/billing/webhooks/stripe}"

# Node prints a notice about its proxy support on every start. It is not an error.
export NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=UNDICI-EHPA"

cd "$REPO_ROOT"
exec pnpm --silent -F @kitstak/billing stripe:events "$@"
