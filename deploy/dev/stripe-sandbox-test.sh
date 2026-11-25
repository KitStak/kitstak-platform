#!/usr/bin/env bash
# Run the real Stripe sandbox suite (docs/billing/STRIPE-SANDBOX-RUN.md). It is skipped everywhere
# else: `pnpm -F @kitstak/billing test` never talks to Stripe.
#
#   deploy/dev/stripe-sandbox-test.sh                 every sandbox test file (about 15 minutes)
#   deploy/dev/stripe-sandbox-test.sh 01-trial        only files whose name has this text
#   STRIPE_SANDBOX_CLEANUP=1 deploy/dev/stripe-sandbox-test.sh
#                                                     also delete the Stripe test clocks it made
#                                                     (their customers and plans go with them)
#
# Needs the local database (deploy/dev/db-setup.sh) and deploy/dev/.run/stripe.env
# (deploy/dev/stripe-env.sh writes it). The Portal does not have to run: the suite calls the same
# server code and the same webhook handler directly. Test mode only. A live key is refused.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -s "$STRIPE_ENV_FILE" ] || "$DEV_DIR/stripe-env.sh"
load_stripe_env || { echo "Could not read $STRIPE_ENV_FILE" >&2; exit 1; }
port_open "$PG_PORT" || "$DEV_DIR/db-start.sh" >/dev/null

export STRIPE_SANDBOX=1
export DATABASE_URL="${DATABASE_URL:-$DEV_DATABASE_URL}"
export STRIPE_SANDBOX_EVIDENCE_DIR="${STRIPE_SANDBOX_EVIDENCE_DIR:-$RUN_DIR/stripe-sandbox}"
# Node prints a notice about its proxy support on every start. It is not an error.
export NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=UNDICI-EHPA"

cd "$REPO_ROOT/packages/billing"
if [ $# -gt 0 ]; then
  filters=()
  for name in "$@"; do filters+=("tests/stripe-sandbox/$name"); done
  exec pnpm exec vitest run "${filters[@]}"
fi
exec pnpm exec vitest run tests/stripe-sandbox
