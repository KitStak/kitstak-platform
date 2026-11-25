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

# Real Stripe TEST mode for the Portal (docs/billing/DEV.md, "Real Stripe test mode"). The env file
# is written by deploy/dev/stripe-env.sh and is never committed. The mode file says which billing
# mode the running Portal was started in, so status.sh and the Stripe tools can tell.
STRIPE_ENV_FILE="$RUN_DIR/stripe.env"
PORTAL_MODE_FILE="$RUN_DIR/portal.billing-mode"

# load_stripe_env: export every NAME=value line of the Stripe env file into this shell.
# Refuses a live key. Returns 1 when the file is missing.
load_stripe_env() {
  local line name value
  [ -s "$STRIPE_ENV_FILE" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    name="${line%%=*}"
    value="${line#*=}"
    case "$name" in STRIPE_* | NODE_USE_ENV_PROXY) ;; *) continue ;; esac
    if [ "$name" = "STRIPE_SECRET_KEY" ]; then
      case "$value" in
        sk_test_* | rk_test_*) ;;
        *) echo "Refused: $STRIPE_ENV_FILE does not hold a Stripe TEST key." >&2; return 2 ;;
      esac
    fi
    export "$name=$value"
  done <"$STRIPE_ENV_FILE"
}

# portal_billing_mode: "stripe" or "test", as the running Portal was started. Empty when unknown.
portal_billing_mode() {
  [ -f "$PORTAL_MODE_FILE" ] && cat "$PORTAL_MODE_FILE" || true
}

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

# app_mem_cap_mb <app>: the memory budget of one dev server and its helpers, in MB. Over it,
# app-supervise.sh restarts the server. KITSTAK_DEV_MEM_MB_<APP> sets one app, KITSTAK_DEV_MEM_MB
# all of them. The defaults add up to 13 GB. A fresh server uses about a third of its budget, and when
# the machine itself runs short the biggest server is restarted first (KITSTAK_DEV_MIN_FREE_MB), so six
# apps and a browser fit in 16 GB.
app_mem_cap_mb() {
  local name value
  name="KITSTAK_DEV_MEM_MB_$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')"
  value="${!name:-${KITSTAK_DEV_MEM_MB:-}}"
  if [ -z "$value" ]; then
    case "$1" in
      portal) value=3000 ;;
      wms) value=2600 ;;
      crm | projects) value=2200 ;;
      pulse) value=1800 ;;
      *) value=1200 ;;
    esac
  fi
  echo "$value"
}

# group_rss_mb <pgid>: memory in use by every process of a process group, in MB. 0 when it is gone.
group_rss_mb() {
  local pids total=0 rss
  pids="$(pgrep -g "$1" 2>/dev/null | tr '\n' ',' | sed 's/,$//')"
  [ -z "$pids" ] && { echo 0; return 0; }
  for rss in $(ps -o rss= -p "$pids" 2>/dev/null); do total=$((total + rss)); done
  echo $((total / 1024))
}

# mem_available_mb: memory that dev processes can still get, in MB. Empty where it cannot be read
# (macOS). It is the smaller of two numbers: what the machine has left, and what the memory group
# (cgroup) of this shell has left. In a dev container the group is the real limit: the system stops
# the biggest process of the group when the group is full, long before the machine is.
mem_available_mb() {
  local avail="" group dir limit="" usage="" cache="" room
  [ -r /proc/meminfo ] && avail="$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo)"
  if [ -r /proc/self/cgroup ]; then
    group="$(awk -F: '$2 == "memory" { print $3; exit }' /proc/self/cgroup)"
    dir="/sys/fs/cgroup/memory$group"
    if [ -n "$group" ] && [ -r "$dir/memory.limit_in_bytes" ]; then
      # cgroup v1. File cache that can be dropped does not count as used.
      limit="$(cat "$dir/memory.limit_in_bytes" 2>/dev/null)"
      usage="$(cat "$dir/memory.usage_in_bytes" 2>/dev/null)"
      cache="$(awk '$1 == "total_inactive_file" { print $2; exit }' "$dir/memory.stat" 2>/dev/null)"
    else
      group="$(awk -F: '$1 == "0" { print $3; exit }' /proc/self/cgroup)"
      dir="/sys/fs/cgroup$group"
      if [ -r "$dir/memory.max" ]; then
        # cgroup v2. "max" means no limit.
        limit="$(cat "$dir/memory.max" 2>/dev/null)"
        usage="$(cat "$dir/memory.current" 2>/dev/null)"
        cache="$(awk '$1 == "inactive_file" { print $2; exit }' "$dir/memory.stat" 2>/dev/null)"
      fi
    fi
    case "$limit" in
      '' | *[!0-9]*) ;;
      *)
        # A limit above 1 TB stands for "no limit".
        if [ "${#limit}" -le 12 ] && [ -n "$usage" ]; then
          room=$(((limit - usage + ${cache:-0}) / 1048576))
          [ "$room" -lt 0 ] && room=0
          if [ -z "$avail" ] || [ "$room" -lt "$avail" ]; then avail="$room"; fi
        fi
        ;;
    esac
  fi
  echo "$avail"
}

# file_mtime <file>: when the file last changed, in seconds since 1970 (Linux and macOS).
file_mtime() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
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
