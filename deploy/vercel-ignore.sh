#!/usr/bin/env bash
# Vercel "Ignored Build Step" for every KitStak app (set as ignoreCommand in each app's vercel.json).
# Exit 0 = skip this build, exit 1 = build.
#
# 1. A commit whose message contains [skip deploy] never builds any app.
# 2. Otherwise an app builds only when it, or a workspace package it depends on, changed
#    since its last successful deployment (turbo-ignore reads the dependency graph).
#    One push no longer rebuilds all apps at once.
set -u

case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[skip deploy]"*)
    echo "Commit message contains [skip deploy]: skipping build."
    exit 0
    ;;
esac

# Runs from the app's Root Directory, so turbo-ignore infers the workspace from ./package.json.
exec npx --yes turbo-ignore --fallback=HEAD^1
