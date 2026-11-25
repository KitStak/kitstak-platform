#!/usr/bin/env bash
# Show what is running: the database and each app, with its port and log file.
#
#   deploy/dev/status.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if port_open "$PG_PORT"; then
  echo "UP    database  $DEV_DATABASE_URL"
else
  echo "DOWN  database  port $PG_PORT  (start: deploy/dev/db-start.sh)"
fi
for app in $ALL_APPS; do
  port="$(app_port "$app")"
  if port_open "$port"; then
    note=""
    if [ "$app" = "portal" ]; then
      case "$(portal_billing_mode)" in
        stripe) note="  billing: REAL STRIPE TEST MODE" ;;
        test) note="  billing: test gateway (default)" ;;
        own-keys) note="  billing: your own Stripe keys" ;;
      esac
    fi
    # Memory in use, and what the supervisor did (deploy/dev/app-supervise.sh).
    if [ -f "$PID_DIR/$app.pid" ]; then
      used="$(group_rss_mb "$(cat "$PID_DIR/$app.pid")")"
      [ "$used" -gt 0 ] && note="$note  memory: ${used} MB"
      if [ -f "$PID_DIR/$app.supervisor" ]; then
        note="$note of $(sed -n 's/^cap_mb=//p' "$PID_DIR/$app.supervisor") MB, restarts: $(sed -n 's/^restarts=//p' "$PID_DIR/$app.supervisor")"
      fi
    fi
    echo "UP    $(printf '%-8s' "$app")  http://localhost:$port  log: $LOG_DIR/$app.log$note"
  else
    echo "DOWN  $(printf '%-8s' "$app")  port $port  (start: deploy/dev/app-start.sh $app)"
  fi
done
left="$(mem_available_mb)"
[ -n "$left" ] && echo "Memory left for dev processes: ${left} MB (under ${KITSTAK_DEV_MIN_FREE_MB:-1536} MB the biggest dev server is restarted)"
