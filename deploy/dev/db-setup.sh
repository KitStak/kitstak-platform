#!/usr/bin/env bash
# Build the whole local database: start Postgres, run every migration in the right
# order, then load the demo data. Safe to run again.
#
#   deploy/dev/db-setup.sh              migrate, and seed only if the demo data is missing
#   deploy/dev/db-setup.sh --migrate    migrate only (use this after you add a migration)
#   deploy/dev/db-setup.sh --reseed     migrate, then reload all demo data
#
# Migration order is the one in docs/DEPLOYMENT.md: CRM, WMS, core, Projects, Pulse.
# Reseeding wipes and rebuilds the two demo orgs only. Orgs you created by signing up stay.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MODE="${1:-auto}"
"$DEV_DIR/db-start.sh"

export NODE_ENV=development
export DATABASE_URL="$DEV_DATABASE_URL" DIRECT_URL="$DEV_DATABASE_URL"
# The seeds read the shared sign-in secret; take it from the generated env files.
"$DEV_DIR/env-init.sh" >/dev/null
export BETTER_AUTH_SECRET="$(cat "$RUN_DIR/auth-secret")"

cd "$REPO_ROOT"
step() { echo; echo "== $*"; }

step "migrate crm";      pnpm --silent --filter kitstak-crm db:migrate
step "migrate wms";      pnpm --silent --filter kitstak-wms db:migrate
step "migrate core";     pnpm --silent --filter @kitstak/db db:migrate
step "migrate projects"; pnpm --silent --filter kitstak-projects db:migrate
step "migrate pulse";    pnpm --silent --filter kitstak-pulse db:migrate

[ "$MODE" = "--migrate" ] && { echo; echo "Migrations done."; exit 0; }

seeded="$(dev_sql "SELECT count(*) FROM core.organization WHERE slug IN ('kitstak', 'northwind-robotics')")"
if [ "$MODE" != "--reseed" ] && [ "$seeded" = "2" ]; then
  echo; echo "Demo data is already there (use --reseed to reload it)."
  exit 0
fi

step "seed crm (org northwind-robotics)"; pnpm --silent --filter kitstak-crm db:seed
step "seed wms (org kitstak)";            pnpm --silent --filter kitstak-wms db:seed | tail -n 3
step "seed wms fixtures";                 pnpm --silent --filter kitstak-wms db:fixtures | head -n 1
step "seed projects (both orgs)";         pnpm --silent --filter kitstak-projects db:seed | tail -n 2
step "seed pulse (both orgs)";            pnpm --silent --filter kitstak-pulse db:seed | grep '^db:seed'
echo; echo "Database is ready: $DEV_DATABASE_URL"
