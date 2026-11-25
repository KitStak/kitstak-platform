#!/usr/bin/env bash
# Put one organization back to "never had a trial or a plan" in the LOCAL database.
#
#   deploy/dev/billing-reset.sh <org-slug>         show what would be removed, remove nothing
#   deploy/dev/billing-reset.sh <org-slug> yes     remove it
#
# It removes that organization's billing rows: the saved cart and trial dates, the plan, invoices,
# activity log, billing managers, cancel answers, queued and sent emails, test gateway objects,
# webhook events, the gateway customer link, and the access rows that came from a trial or a plan.
# It also frees the free trial of the people who started one for this organization.
#
# It keeps: the organization, its people, its data in every app, and manual grants (access rows
# with source 'manual'), because those are not billing.
#
# It refuses to run against anything but a database on this machine. There is no way to point it
# at production, on purpose.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SLUG="${1:-}"
CONFIRM="${2:-}"
if [ -z "$SLUG" ] || { [ -n "$CONFIRM" ] && [ "$CONFIRM" != "yes" ]; }; then
  echo "Usage: deploy/dev/billing-reset.sh <org-slug> [yes]" >&2
  exit 2
fi
if ! printf '%s' "$SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{0,62}$'; then
  echo "That does not look like an organization slug: $SLUG" >&2
  exit 2
fi

# The address may be overridden for a second local cluster, but only a local one.
URL="${KITSTAK_RESET_DATABASE_URL:-$DEV_DATABASE_URL}"
HOST="$(node -e 'try { console.log(new URL(process.argv[1]).hostname) } catch { console.log("") }' "$URL")"
case "$HOST" in
  127.0.0.1 | localhost | ::1 | "[::1]") ;;
  *)
    echo "Refusing to run: the database host is '$HOST', not this machine." >&2
    echo "This script only resets a local dev database." >&2
    exit 1
    ;;
esac

ORG_ID="$(dev_sql "SELECT id FROM core.organization WHERE slug = '$SLUG'" "$URL")"
if [ -z "$ORG_ID" ]; then
  echo "No organization with slug '$SLUG' in the local database." >&2
  exit 1
fi

COUNTS="
SELECT 'trial and cart (billing_accounts)', count(*) FROM core.billing_accounts WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'plan (billing_subscriptions)', count(*) FROM core.billing_subscriptions WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'invoices', count(*) FROM core.billing_invoices WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'activity log rows', count(*) FROM core.billing_audit_log WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'billing managers', count(*) FROM core.billing_managers WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'cancel answers', count(*) FROM core.billing_cancel_feedback WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'emails', count(*) FROM core.billing_emails WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'test gateway objects', count(*) FROM core.billing_test_objects WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'webhook events', count(*) FROM core.billing_events WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'gateway customer link', count(*) FROM core.stripe_customers WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'trial uses', count(*) FROM core.billing_trial_uses WHERE org_id = '$ORG_ID'
UNION ALL SELECT 'access rows from a trial or plan', count(*) FROM core.entitlements WHERE org_id = '$ORG_ID' AND source <> 'manual'
UNION ALL SELECT 'manual grants (kept)', count(*) FROM core.entitlements WHERE org_id = '$ORG_ID' AND source = 'manual'
"

echo "Organization: $SLUG ($ORG_ID) on $HOST"
dev_sql "$COUNTS" "$URL" | awk -F'\t' '{ printf "  %-36s %s\n", $1, $2 }'

if [ "$CONFIRM" != "yes" ]; then
  echo
  echo "Nothing was removed. Run again with the word yes to remove these rows."
  exit 0
fi

dev_sql "
BEGIN;
DELETE FROM core.billing_test_objects WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_events WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_emails WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_cancel_feedback WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_managers WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_audit_log WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_invoices WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_subscriptions WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_trial_uses WHERE org_id = '$ORG_ID';
DELETE FROM core.billing_accounts WHERE org_id = '$ORG_ID';
DELETE FROM core.stripe_customers WHERE org_id = '$ORG_ID';
DELETE FROM core.entitlements WHERE org_id = '$ORG_ID' AND source <> 'manual';
DELETE FROM core.rate_limit WHERE key LIKE 'billing:%$ORG_ID%';
COMMIT;
" "$URL"

echo
echo "Done. $SLUG has no trial and no plan now. Manual grants were kept."
echo "Running apps cache access for up to a minute. Restart an app to see the change at once."
