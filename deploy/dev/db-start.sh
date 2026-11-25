#!/usr/bin/env bash
# Start the local Postgres for every KitStak app. Safe to run again and again.
#
#   deploy/dev/db-start.sh
#
# First run creates the cluster in apps/crm/.data/pg and the database "kitstak".
# Later runs only start the server when it is not already running.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BIN="$(pg_bin_dir)"

if port_open "$PG_PORT" && [ ! -f "$PG_DATA/postmaster.pid" ]; then
  echo "Port $PG_PORT is in use by something that is not this cluster. Free it or set KITSTAK_PG_PORT." >&2
  exit 1
fi

mkdir -p "$PG_ROOT"
if [ ! -f "$PG_DATA/PG_VERSION" ]; then
  mkdir -p "$PG_DATA"
  pwfile="$(mktemp)"
  printf '%s\n' "$PG_PASSWORD" >"$pwfile"
  chmod 644 "$pwfile"
  if [ "$(id -u)" -eq 0 ]; then chown -R postgres "$PG_DATA"; fi
  as_pg_user "$BIN/initdb" -D "$PG_DATA" -U "$PG_USER" --pwfile="$pwfile" \
    --auth=scram-sha-256 --encoding=UTF8 --locale=C >/dev/null
  rm -f "$pwfile"
  echo "Created a new Postgres cluster in $PG_DATA"
fi

touch "$PG_LOG"
if [ "$(id -u)" -eq 0 ]; then chown -R postgres "$PG_DATA" "$PG_LOG"; fi

if as_pg_user "$BIN/pg_ctl" status -D "$PG_DATA" >/dev/null 2>&1; then
  echo "Postgres already running on port $PG_PORT"
else
  as_pg_user "$BIN/pg_ctl" start -w -t 60 -D "$PG_DATA" -l "$PG_LOG" \
    -o "-p $PG_PORT -c listen_addresses=localhost" >/dev/null
  echo "Postgres started on port $PG_PORT (log: $PG_LOG)"
fi

exists="$(dev_sql "SELECT 1 FROM pg_database WHERE datname = '$PG_DATABASE'" "postgres://$PG_USER:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres")"
if [ "$exists" != "1" ]; then
  dev_sql "CREATE DATABASE \"$PG_DATABASE\" ENCODING 'UTF8' TEMPLATE template0" \
    "postgres://$PG_USER:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres"
  echo "Created database \"$PG_DATABASE\""
fi
echo "DATABASE_URL=$DEV_DATABASE_URL"
