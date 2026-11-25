#!/usr/bin/env bash
# Write the untracked env file that puts the local Portal in real Stripe TEST mode.
#
#   deploy/dev/stripe-env.sh           create deploy/dev/.run/stripe.env if it is missing, then check it
#   deploy/dev/stripe-env.sh --print   show the file with the secrets hidden
#   deploy/dev/stripe-env.sh --renew   write the file again (new local webhook secret)
#
# The file is read by `KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal`, by
# deploy/dev/stripe-events.sh and by deploy/dev/stripe-sandbox-test.sh. It lives in
# deploy/dev/.run/, which is gitignored. Never commit it.
#
# Where the key comes from:
#  - In a cloud dev container the network proxy adds the sandbox key to every request to
#    api.stripe.com. Code sends the placeholder sk_test_proxyinjected and never sees the real key.
#    This is the default when HTTPS_PROXY is set and you gave no key.
#  - On your own machine, export your own TEST key first: STRIPE_SECRET_KEY=sk_test_... (or rk_test_...).
#
# This script refuses a live key, and it refuses an account that answers in live mode. It only
# reads from Stripe. It never creates, changes or disables anything there.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE="$RUN_DIR/stripe.env"
PLACEHOLDER_KEY=sk_test_proxyinjected
MODE="${1:-ensure}"

case "$MODE" in
  ensure | --print | --renew) ;;
  *) echo "Usage: deploy/dev/stripe-env.sh [--print|--renew]" >&2; exit 2 ;;
esac

if [ "$MODE" = "--print" ]; then
  [ -f "$ENV_FILE" ] || { echo "No $ENV_FILE yet. Run deploy/dev/stripe-env.sh" >&2; exit 1; }
  # The placeholder is not a secret, so it is shown. A real test key and the webhook secret are hidden.
  sed -E -e 's/^(STRIPE_WEBHOOK_SECRET=).*/\1<hidden>/' \
    -e "/^STRIPE_SECRET_KEY=$PLACEHOLDER_KEY\$/!s/^(STRIPE_SECRET_KEY=).*/\\1<hidden>/" "$ENV_FILE"
  exit 0
fi

stripe_get() {
  # $1 = key, $2 = path. Prints the body. The key goes in through basic auth, never on the command line of a log.
  curl -sS -m 30 -u "$1:" "https://api.stripe.com$2"
}

json_field() {
  # Reads JSON on stdin and prints one value picked by the small script in $1.
  node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => {
      let data;
      try { data = JSON.parse(text); } catch { process.exit(3); }
      const value = new Function("d", process.argv[1])(data);
      if (value !== undefined && value !== null) process.stdout.write(String(value));
    });
  ' "$1"
}

if [ "$MODE" = "--renew" ] || [ ! -s "$ENV_FILE" ]; then
  key="${STRIPE_SECRET_KEY:-}"
  via_proxy=0
  if [ -z "$key" ]; then
    if [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
      key="$PLACEHOLDER_KEY"
      via_proxy=1
    else
      echo "No Stripe test key. Export your own first:  STRIPE_SECRET_KEY=sk_test_... deploy/dev/stripe-env.sh" >&2
      exit 1
    fi
  fi
  [ "$key" = "$PLACEHOLDER_KEY" ] && via_proxy=1
  case "$key" in
    sk_test_* | rk_test_*) ;;
    *) echo "Refused: STRIPE_SECRET_KEY is not a Stripe TEST key. Local dev never uses a live key." >&2; exit 1 ;;
  esac

  balance="$(stripe_get "$key" /v1/balance)"
  livemode="$(printf '%s' "$balance" | json_field 'return d.error ? "error: " + d.error.message : d.livemode')" || {
    echo "Stripe did not answer with JSON. Is api.stripe.com reachable from here?" >&2; exit 1; }
  case "$livemode" in
    false) ;;
    true) echo "Refused: this key answers in LIVE mode. Nothing was written." >&2; exit 1 ;;
    *) echo "Stripe refused the key ($livemode). Nothing was written." >&2; exit 1 ;;
  esac
  account="$(stripe_get "$key" /v1/account | json_field 'return d.id')"

  portal="${STRIPE_PORTAL_CONFIGURATION_ID:-}"
  if [ -z "$portal" ]; then
    # The configuration that `stripe:setup apply` made carries this label.
    portal="$(stripe_get "$key" '/v1/billing_portal/configurations?active=true&limit=100' |
      json_field 'const c = (d.data || []).find((x) => x.metadata && x.metadata.kitstak_config === "billing_portal"); return c ? c.id : ""')"
  fi
  if [ -z "$portal" ]; then
    echo "This Stripe account has no KitStak billing portal configuration yet. Run this first:" >&2
    echo "  STRIPE_SECRET_KEY=$( [ "$via_proxy" -eq 1 ] && echo "$PLACEHOLDER_KEY" || echo 'sk_test_yours' ) STRIPE_HTTP_CLIENT=fetch NODE_USE_ENV_PROXY=1 pnpm -F @kitstak/billing stripe:setup apply" >&2
    exit 1
  fi

  secret="whsec_local_$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  (
    umask 077
    {
      echo "# Local development only. Written by deploy/dev/stripe-env.sh. Never commit this file."
      echo "# Stripe TEST mode for the local Portal. Account: $account"
      echo "STRIPE_SECRET_KEY=$key"
      echo "# Made on this machine. Stripe does not know it. deploy/dev/stripe-events.sh signs with it."
      echo "STRIPE_WEBHOOK_SECRET=$secret"
      echo "STRIPE_PORTAL_CONFIGURATION_ID=$portal"
      echo "STRIPE_SANDBOX_ACCOUNT=$account"
      if [ "$via_proxy" -eq 1 ] || [ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]; then
        echo "# Behind a proxy: the Stripe SDK must use fetch, and Node must follow HTTPS_PROXY."
        echo "STRIPE_HTTP_CLIENT=fetch"
        echo "NODE_USE_ENV_PROXY=1"
      fi
    } >"$ENV_FILE"
  )
  echo "created  deploy/dev/.run/stripe.env  (account $account, test mode, portal configuration $portal)"
else
  echo "kept     deploy/dev/.run/stripe.env (already there). Use --renew to write it again."
fi

# Check the file every time: a live key must never get this far.
if grep -Eq '^STRIPE_SECRET_KEY=(sk|rk)_live_' "$ENV_FILE"; then
  echo "Refused: deploy/dev/.run/stripe.env holds a LIVE key. Remove the file." >&2
  exit 1
fi
