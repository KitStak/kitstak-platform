#!/usr/bin/env bash
# Shared settings for the local dev scripts in deploy/dev. Source it, do not run it.
# Everything here is for local development only. No secret lives in this file.

DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEV_DIR/../.." && pwd)"
RUN_DIR="$DEV_DIR/.run"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Same cluster location, port and login as `pnpm --filter kitstak-crm db:start`
# (apps/crm/src/server/db/embedded.ts), so both ways of starting it share one database.
PG_PORT="${KITSTAK_PG_PORT:-5544}"
PG_USER=postgres
PG_PASSWORD=postgres
PG_DATABASE=kitstak
PG_ROOT="$REPO_ROOT/apps/crm/.data"
PG_DATA="$PG_ROOT/pg"
PG_LOG="$PG_ROOT/pg.log"
export DEV_DATABASE_URL="postgres://$PG_USER:$PG_PASSWORD@127.0.0.1:$PG_PORT/$PG_DATABASE"

ALL_APPS="portal crm wms projects pulse web"

# app_port <app>: the port each app listens on in local dev.
# web runs on 3600 (its own `dev` script uses the same port), so it never collides with Projects on 3400.
app_port() {
  case "$1" in
    portal) echo 3300 ;;
    crm) echo 3100 ;;
    wms) echo 3000 ;;
    projects) echo 3400 ;;
    pulse) echo 3500 ;;
    web) echo 3600 ;;
    *) return 1 ;;
  esac
}

# app_ready_path <app>: a cheap public URL that proves the server compiles and answers.
app_ready_path() {
  case "$1" in
    crm) echo /api/v1/health ;;
    pulse) echo /api/health ;;
    portal | wms | projects) echo /login ;;
    *) echo / ;;
  esac
}

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# PostgreSQL refuses to run as root. In a root container the server runs as the
# `postgres` system user; on a normal developer machine it runs as you.
as_pg_user() {
  if [ "$(id -u)" -eq 0 ]; then
    if ! id postgres >/dev/null 2>&1; then
      echo "Running as root but there is no 'postgres' system user. Create one: useradd -r postgres" >&2
      return 1
    fi
    runuser -u postgres -- "$@"
  else
    "$@"
  fi
}

# Folder with initdb, pg_ctl and postgres from the embedded-postgres package for this machine.
pg_bin_dir() {
  local platform dir
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) platform=linux-x64 ;;
    Linux-aarch64) platform=linux-arm64 ;;
    Darwin-arm64) platform=darwin-arm64 ;;
    Darwin-x86_64) platform=darwin-x64 ;;
    *) echo "No embedded Postgres for $(uname -s)-$(uname -m)." >&2; return 1 ;;
  esac
  dir="$(ls -d "$REPO_ROOT"/node_modules/.pnpm/@embedded-postgres+"$platform"@*/node_modules/@embedded-postgres/"$platform"/native/bin 2>/dev/null | sort | tail -n 1)"
  if [ -z "$dir" ] || [ ! -x "$dir/pg_ctl" ]; then
    echo "Embedded Postgres binaries not found. Run 'pnpm install' at the repo root first." >&2
    return 1
  fi
  echo "$dir"
}

# Run SQL as the superuser against the dev database. Uses node + pg, so no psql is needed.
dev_sql() {
  (cd "$REPO_ROOT/apps/crm" && DEV_SQL="$1" DEV_SQL_URL="${2:-$DEV_DATABASE_URL}" node -e '
    const pg = require("pg");
    const client = new pg.Client({ connectionString: process.env.DEV_SQL_URL });
    client.connect()
      .then(() => client.query(process.env.DEV_SQL))
      .then((result) => { for (const row of result.rows ?? []) console.log(Object.values(row).join("\t")); })
      .catch((error) => { console.error(error.message); process.exitCode = 1; })
      .finally(() => client.end());
  ')
}
