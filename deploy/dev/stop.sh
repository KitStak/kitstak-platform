#!/usr/bin/env bash
# Stop local dev processes.
#
#   deploy/dev/stop.sh              stop every app and the database
#   deploy/dev/stop.sh apps         stop every app, keep the database
#   deploy/dev/stop.sh portal crm   stop only these apps
#   deploy/dev/stop.sh db           stop only the database
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Pids listening on a TCP port (the Next server itself, whoever started it).
port_pids() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null || true
  fi
}

stop_app() {
  local app="$1" port pid_file pid group=""
  port="$(app_port "$app")" || { echo "Unknown app: $app" >&2; return 2; }
  pid_file="$PID_DIR/$app.pid"
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    group="$pid"
    # Negative pid = the whole process group that app-start.sh created with setsid.
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port_open "$port" || break
    for pid in $(port_pids "$port"); do kill -TERM "$pid" 2>/dev/null || true; done
    sleep 0.5
  done
  if port_open "$port"; then
    for pid in $(port_pids "$port"); do kill -KILL "$pid" 2>/dev/null || true; done
    sleep 0.5
  fi
  if port_open "$port"; then
    echo "STILL UP  $app on port $port (stop it by hand)" >&2
    return 1
  fi
  # The port closes before the server is gone: next dev still writes its cache on the way out. Wait
  # for the whole group, so a start right after never shares apps/<app>/.next/dev with a server
  # that is still leaving (see "A page reloads itself over and over" in docs/billing/DEV.md).
  if [ -n "$group" ]; then
    for _ in $(seq 1 60); do
      pgrep -g "$group" >/dev/null 2>&1 || break
      sleep 0.25
    done
    pkill -KILL -g "$group" 2>/dev/null || true
  fi
  echo "stopped  $app"
}

stop_db() {
  local bin
  bin="$(pg_bin_dir)"
  if as_pg_user "$bin/pg_ctl" status -D "$PG_DATA" >/dev/null 2>&1; then
    as_pg_user "$bin/pg_ctl" stop -w -m fast -D "$PG_DATA" >/dev/null
    echo "stopped  database"
  else
    echo "stopped  database (was not running)"
  fi
}

targets="$*"
[ $# -eq 0 ] && targets="$ALL_APPS db"
[ "${1:-}" = "apps" ] && targets="$ALL_APPS"
status=0
for target in $targets; do
  if [ "$target" = "db" ]; then stop_db || status=1; else stop_app "$target" || status=1; fi
done
exit $status
