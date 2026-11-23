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
    echo "UP    $(printf '%-8s' "$app")  http://localhost:$port  log: $LOG_DIR/$app.log"
  else
    echo "DOWN  $(printf '%-8s' "$app")  port $port  (start: deploy/dev/app-start.sh $app)"
  fi
done
