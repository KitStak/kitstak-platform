#!/usr/bin/env bash
# Create an untracked .env.local for every app that does not have one yet.
#
#   deploy/dev/env-init.sh           create the missing files
#   deploy/dev/env-init.sh --print   show what would be written, write nothing
#
# An existing .env.local is never overwritten, so your own edits (Stripe test keys and
# so on) are safe. The shared sign-in secret is generated on this machine on the first
# run and kept in deploy/dev/.run/auth-secret (gitignored). It is never committed.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PRINT=0
[ "${1:-}" = "--print" ] && PRINT=1

SECRET_FILE="$RUN_DIR/auth-secret"
if [ ! -s "$SECRET_FILE" ]; then
  # Reuse a secret an app already has, so existing sessions keep working.
  existing=""
  for app in $ALL_APPS; do
    file="$REPO_ROOT/apps/$app/.env.local"
    if [ -f "$file" ]; then
      existing="$(grep -E '^BETTER_AUTH_SECRET=.{32,}' "$file" | head -n 1 | cut -d= -f2- || true)"
      [ -n "$existing" ] && break
    fi
  done
  if [ -z "$existing" ]; then
    existing="$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")"
  fi
  (umask 077 && printf '%s\n' "$existing" >"$SECRET_FILE")
fi
SECRET="$(cat "$SECRET_FILE")"

PORTAL=http://localhost:3300
CRM=http://localhost:3100
WMS=http://localhost:3000
PROJECTS=http://localhost:3400
PULSE=http://localhost:3500
WEB=http://localhost:3600

env_body() {
  local app="$1" own="$2"
  cat <<BODY
# Local development only. Written by deploy/dev/env-init.sh. Never commit this file.
NODE_ENV=development
DATABASE_URL=$DEV_DATABASE_URL
DIRECT_URL=$DEV_DATABASE_URL
# Must be the same in every app: one sign-in works across all of them.
BETTER_AUTH_SECRET=$SECRET
BETTER_AUTH_URL=$own
NEXT_PUBLIC_APP_URL=$own
TRUSTED_ORIGINS=$PORTAL,$CRM,$WMS,$PROJECTS,$PULSE
NEXT_PUBLIC_PORTAL_URL=$PORTAL
NEXT_PUBLIC_CRM_URL=$CRM
NEXT_PUBLIC_WMS_URL=$WMS
NEXT_PUBLIC_PROJECTS_URL=$PROJECTS
NEXT_PUBLIC_PULSE_URL=$PULSE
# 1 = every org can open every app. Set to 0 to test real plans, trials and locked screens.
ENTITLEMENTS_DEV_ALLOW_ALL=1
BODY
  case "$app" in
    wms)
      cat <<BODY
# Shows the demo login on the WMS sign-in page.
DEMO_MODE=1
BODY
      ;;
    portal)
      cat <<BODY

# Billing. Leave these empty to use the built-in test gateway (labeled "Test mode").
# To try real Stripe test mode, paste your own test keys here. Never commit them.
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# STRIPE_PORTAL_CONFIGURATION_ID=
# STRIPE_AUTOMATIC_TAX=
# The billing job (deploy/dev/billing-tick.sh). Leave empty locally: no secret is needed.
# CRON_SECRET=

# Email. Leave these empty to keep every email in the dev outbox: $PORTAL/dev/outbox
# EMAIL_PROVIDER=
# RESEND_API_KEY=
# EMAIL_FROM=
# EMAIL_REPLY_TO=

# Sign in with Google or Microsoft. A button shows only when the id and the secret are both set.
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=
# MICROSOFT_CLIENT_ID=
# MICROSOFT_CLIENT_SECRET=
# MICROSOFT_TENANT_ID=

# The marketing site, for "Talk to us" and pricing links. The legal links default to the CRM pages.
NEXT_PUBLIC_SITE_URL=$WEB
# NEXT_PUBLIC_TERMS_URL=
# NEXT_PUBLIC_PRIVACY_URL=
BODY
      ;;
  esac
}

for app in $ALL_APPS; do
  [ "$app" = "web" ] && continue # the marketing site needs no env
  file="$REPO_ROOT/apps/$app/.env.local"
  own="http://localhost:$(app_port "$app")"
  if [ "$PRINT" -eq 1 ]; then
    echo "--- $file"
    env_body "$app" "$own" | sed -E 's/^(BETTER_AUTH_SECRET=).*/\1<hidden>/'
  elif [ -f "$file" ]; then
    echo "kept     apps/$app/.env.local (already there)"
  else
    (umask 077 && env_body "$app" "$own" >"$file")
    echo "created  apps/$app/.env.local"
  fi
done
