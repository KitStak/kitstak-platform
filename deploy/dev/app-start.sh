#!/usr/bin/env bash
# Start one or more apps in the background. Safe to run again: an app that is already
# listening on its port is left alone and reused.
#
#   deploy/dev/app-start.sh portal            start Portal on 3300
#   deploy/dev/app-start.sh portal crm wms    start several
#   deploy/dev/app-start.sh all               portal crm wms projects pulse web
#
# Ports: portal 3300, crm 3100, wms 3000, projects 3400, pulse 3500, web 3600.
# Logs:  deploy/dev/.run/logs/<app>.log
# The script waits until the app answers a real page, so when it prints READY you can use it.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ $# -eq 0 ] && { echo "Usage: deploy/dev/app-start.sh <portal|crm|wms|projects|pulse|web|all> ..." >&2; exit 2; }
apps="$*"
[ "$1" = "all" ] && apps="$ALL_APPS"
TIMEOUT="${KITSTAK_START_TIMEOUT:-240}"

http_code() { curl -s -o /dev/null -m 120 -w '%{http_code}' "$1" 2>/dev/null || true; }

start_one() {
  local app="$1" port ready log pid code waited=0
  port="$(app_port "$app")" || { echo "Unknown app: $app" >&2; return 2; }
  ready="http://localhost:$port$(app_ready_path "$app")"
  log="$LOG_DIR/$app.log"

  # One starter at a time per app, so two people (or agents) cannot race.
  exec 9>"$PID_DIR/$app.lock"
  flock 9

  if port_open "$port"; then
    echo "READY  $app  http://localhost:$port  (already running, log: $log)"
    flock -u 9
    return 0
  fi
  if [ "$app" != "web" ] && [ ! -f "$REPO_ROOT/apps/$app/.env.local" ]; then
    "$DEV_DIR/env-init.sh" >/dev/null
  fi
  if [ "$app" != "web" ] && ! port_open "$PG_PORT"; then
    "$DEV_DIR/db-start.sh" >/dev/null
  fi

  : >"$log"
  (
    cd "$REPO_ROOT/apps/$app"
    # setsid: the server gets its own process group, so it outlives this shell and
    # stop.sh can stop the whole group (next dev spawns helper processes).
    NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 \
      setsid nohup pnpm exec next dev -p "$port" >>"$log" 2>&1 9>&- &
    echo $! >"$PID_DIR/$app.pid"
  )
  pid="$(cat "$PID_DIR/$app.pid")"

  while :; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "FAILED $app  the server exited. Last log lines:" >&2
      tail -n 25 "$log" >&2
      flock -u 9
      return 1
    fi
    if port_open "$port"; then
      code="$(http_code "$ready")"
      case "$code" in 2* | 3* | 401 | 403) break ;; esac
    fi
    sleep 2
    waited=$((waited + 2))
    if [ "$waited" -ge "$TIMEOUT" ]; then
      echo "FAILED $app  no answer from $ready after ${TIMEOUT}s (last status: ${code:-none}). See $log" >&2
      flock -u 9
      return 1
    fi
  done
  echo "READY  $app  http://localhost:$port  (pid $pid, log: $log)"
  flock -u 9
}

status=0
for app in $apps; do
  start_one "$app" || status=1
done
exit $status
