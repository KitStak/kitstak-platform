#!/usr/bin/env sh
# Build entry point on Vercel (`npm run vercel-build`).
# Production deploys apply pending migrations first. Preview builds have no database.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  tsx scripts/db-migrate.ts
  # Opt-in: (re)load the Northwind Robotics demo organization. Leave unset for real data.
  if [ "$ALLOW_DEMO_SEED" = "1" ]; then
    tsx src/server/db/seed/index.ts
  fi
fi

next build
