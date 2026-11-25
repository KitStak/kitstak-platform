#!/usr/bin/env bash
# Start one or more apps in the background. Safe to run again: an app that is already
# listening on its port is left alone and reused.
#
#   deploy/dev/app-start.sh portal            start Portal on 3300
#   deploy/dev/app-start.sh portal crm wms    start several
#   deploy/dev/app-start.sh all               portal crm wms projects pulse web
#
#   KITSTAK_STRIPE=1 deploy/dev/app-start.sh portal
#                                             start Portal in real Stripe TEST mode. The settings
#                                             come from deploy/dev/.run/stripe.env, which
#                                             deploy/dev/stripe-env.sh writes. Without the switch
#                                             the Portal uses the built in test gateway (the default).
#
#   KITSTAK_DEV_MEM_MB_WMS=3000 deploy/dev/app-start.sh wms
#                                             give one dev server another memory budget (in MB).
#                                             Each server runs under deploy/dev/app-supervise.sh,
#                                             which starts it again when it exits and restarts it
#                                             when it grows over its budget, so a long test run does
#                                             not end with the machine out of memory.
#                                             KITSTAK_DEV_SUPERVISE=0 starts the bare server instead.
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

# True when some `next dev` process already runs from this app folder (on any port). Its cache is
# in use then, and must not be removed.
dev_server_runs_in() {
  local pid
  for pid in $(pgrep -f 'next(/dist/bin/next)? dev' 2>/dev/null || true); do
    [ "$(readlink "/proc/$pid/cwd" 2>/dev/null || true)" = "$1" ] && return 0
  done
  return 1
}

start_one() {
  local app="$1" port ready log pid code waited=0
  port="$(app_port "$app")" || { echo "Unknown app: $app" >&2; return 2; }
  ready="http://localhost:$port$(app_ready_path "$app")"
  log="$LOG_DIR/$app.log"

  # One starter at a time per app, so two people (or agents) cannot race.
  exec 9>"$PID_DIR/$app.lock"
  flock 9

  # The Portal has two billing modes. The switch picks one for this start.
  local want_mode=""
  if [ "$app" = "portal" ]; then
    want_mode=test
    if [ "${KITSTAK_STRIPE:-0}" = "1" ]; then
      want_mode=stripe
    elif [ -n "${STRIPE_SECRET_KEY:-}" ] || grep -Eq '^STRIPE_SECRET_KEY=.+' "$REPO_ROOT/apps/portal/.env.local" 2>/dev/null; then
      # Your own keys, from the shell or from apps/portal/.env.local. The script does not manage them.
      want_mode=own-keys
    fi
  fi

  if port_open "$port"; then
    if [ -n "$want_mode" ] && [ -n "$(portal_billing_mode)" ] && [ "$(portal_billing_mode)" != "$want_mode" ]; then
      echo "WRONG MODE  portal is running in $(portal_billing_mode) mode and you asked for $want_mode mode." >&2
      echo "            Stop it first: deploy/dev/stop.sh portal" >&2
      flock -u 9
      return 1
    fi
    echo "READY  $app  http://localhost:$port  (already running${want_mode:+, billing mode: $(portal_billing_mode)}, log: $log)"
    flock -u 9
    return 0
  fi
  if [ "$app" != "web" ] && [ ! -f "$REPO_ROOT/apps/$app/.env.local" ]; then
    "$DEV_DIR/env-init.sh" >/dev/null
  fi
  if [ "$app" != "web" ] && ! port_open "$PG_PORT"; then
    "$DEV_DIR/db-start.sh" >/dev/null
  fi

  # Start from a clean dev cache. A cache left behind by a server that was stopped by the memory
  # limit, or that was still writing when the next one started, can make the new server tell every
  # browser tab to reload without end (docs/billing/DEV.md, "A page reloads itself over and over").
  # The cache is build output only. KITSTAK_KEEP_DEV_CACHE=1 keeps it.
  if [ "${KITSTAK_KEEP_DEV_CACHE:-0}" != "1" ] && ! dev_server_runs_in "$REPO_ROOT/apps/$app"; then
    rm -rf "$REPO_ROOT/apps/$app/.next/dev"
  fi

  : >"$log"
  rm -f "$PID_DIR/$app.supervisor"
  (
    if [ "$want_mode" = "stripe" ]; then
      # Real Stripe TEST mode: the key, the local webhook secret and the proxy settings come from the
      # untracked env file. A variable on the command line wins over apps/portal/.env.local.
      [ -s "$STRIPE_ENV_FILE" ] || "$DEV_DIR/stripe-env.sh" >&2
      load_stripe_env || { echo "FAILED portal  could not read $STRIPE_ENV_FILE" >&2; exit 1; }
    fi
    [ -n "$want_mode" ] && echo "$want_mode" >"$PORTAL_MODE_FILE"
    cd "$REPO_ROOT/apps/$app"
    # setsid: the server gets its own process group, so it outlives this shell and
    # stop.sh can stop the whole group (next dev spawns helper processes).
    if [ "${KITSTAK_DEV_SUPERVISE:-1}" = "0" ]; then
      NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 \
        setsid nohup pnpm exec next dev -p "$port" >>"$log" 2>&1 9>&- &
    else
      # The supervisor is the group leader. It keeps the server alive and inside its memory
      # budget (deploy/dev/app-supervise.sh). The dev cache is cleaned by it at every (re)start.
      setsid nohup "$DEV_DIR/app-supervise.sh" "$app" "$port" >/dev/null 2>&1 9>&- &
    fi
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
  echo "READY  $app  http://localhost:$port  (pid $pid${want_mode:+, billing mode: $want_mode}, log: $log)"
  flock -u 9
}

status=0
for app in $apps; do
  start_one "$app" || status=1
done
exit $status
