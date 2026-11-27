#!/usr/bin/env bash
# Keeps one dev server alive and inside a memory budget. Started by app-start.sh. Not for direct use.
#
#   deploy/dev/app-supervise.sh <app> <port>
#
# Why: a `next dev` server that has compiled many routes grows past 3 or 4 GB. With six of them and
# a browser the machine runs out of memory, and the system then stops whatever is biggest without a
# word: a dev server, or the browser tab of the test that is running (docs/billing/DEV.md, "Memory").
#
# What this does, for one app:
#   - starts `next dev` with a cap on the JavaScript heap,
#   - starts it again when it exits by itself (a crash, or stopped by the system),
#   - watches the memory of the server and its helpers. Over the app's budget it restarts the server
#     at a quiet moment (no request logged for a while), so a test that is running is not cut off.
#     It restarts at once only when it has to: the whole machine is nearly out of memory and this
#     app is the biggest one, or the server is at twice its budget,
#   - writes one line for every start and restart to the app's log and to logs/supervisor.log.
#
# It never touches the database or any data. A restart only drops the server's compile cache.
# Settings (all optional): see "Memory budget" in docs/billing/DEV.md.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

app="${1:?app}"
port="${2:?port}"
log="$LOG_DIR/$app.log"
sup_log="$LOG_DIR/supervisor.log"
state_file="$PID_DIR/$app.supervisor"
cap_mb="$(app_mem_cap_mb "$app")"
hard_mb=$((cap_mb * 2))
heap_mb="${KITSTAK_DEV_HEAP_MB:-$((cap_mb * 3 / 4))}"
min_free_mb="${KITSTAK_DEV_MIN_FREE_MB:-1536}"
quiet_seconds="${KITSTAK_DEV_QUIET_SECONDS:-15}"
check_seconds="${KITSTAK_DEV_CHECK_SECONDS:-5}"
grace_seconds="${KITSTAK_DEV_GRACE_SECONDS:-90}"
restarts=0
quick_exits=0
young_restarts=0
memory_guard=on
stopping=0
child=""

note() {
  local line="[supervisor $(date -u +%H:%M:%SZ)] $app: $*"
  echo "$line" >>"$sup_log"
  echo "$line" >>"$log"
}

write_state() {
  printf 'restarts=%s\ncap_mb=%s\nlast=%s\n' "$restarts" "$cap_mb" "$1" >"$state_file"
}

# Every process of this app but the supervisor itself. app-start.sh gives the supervisor its own
# process group (setsid), and the dev server and its helpers stay in it.
members() {
  local pid
  for pid in $(pgrep -g "$$" 2>/dev/null || true); do
    [ "$pid" = "$$" ] || [ "$pid" = "$BASHPID" ] || echo "$pid"
  done
}

stop_children() {
  local pid waited=0
  for pid in $(members); do kill -TERM "$pid" 2>/dev/null || true; done
  # next dev writes its cache on the way out. Wait until the whole group is gone.
  while [ -n "$(members)" ] && [ "$waited" -lt 60 ]; do
    sleep 0.25
    waited=$((waited + 1))
  done
  for pid in $(members); do kill -KILL "$pid" 2>/dev/null || true; done
  [ -n "$child" ] && wait "$child" 2>/dev/null
  child=""
}

on_stop() {
  stopping=1
  stop_children
  rm -f "$state_file"
  exit 0
}
trap on_stop TERM INT HUP

start_child() {
  # A clean dev cache for every start (docs/billing/DEV.md, "A page reloads itself over and over").
  if [ "${KITSTAK_KEEP_DEV_CACHE:-0}" != "1" ]; then rm -rf "$REPO_ROOT/apps/$app/.next/dev"; fi
  local options="${NODE_OPTIONS:-}"
  if [ "$heap_mb" -gt 0 ] && [[ "$options" != *max-old-space-size* ]]; then
    options="${options:+$options }--max-old-space-size=$heap_mb"
  fi
  (
    cd "$REPO_ROOT/apps/$app" || exit 1
    NODE_OPTIONS="$options" NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 exec pnpm exec next dev -p "$port"
  ) >>"$log" 2>&1 &
  child=$!
  started_at=$(date +%s)
}

# Seconds since the server last wrote to its log (it logs every request).
quiet_for() {
  local now changed
  now=$(date +%s)
  changed=$(file_mtime "$log")
  echo $((now - changed))
}

# True when this app uses more memory than every other supervised app.
biggest_app() {
  local other mine theirs
  mine="$(group_rss_mb "$$")"
  for other in $ALL_APPS; do
    [ "$other" = "$app" ] && continue
    [ -f "$PID_DIR/$other.pid" ] || continue
    theirs="$(group_rss_mb "$(cat "$PID_DIR/$other.pid")")"
    [ "$theirs" -gt "$mine" ] && return 1
  done
  return 0
}

note "started (memory budget ${cap_mb} MB: over it, a restart at the next quiet moment. At once over ${hard_mb} MB, or when the machine has under ${min_free_mb} MB left. JavaScript heap cap ${heap_mb} MB)"
write_state started
start_child

while [ "$stopping" = "0" ]; do
  sleep "$check_seconds" &
  wait $! 2>/dev/null
  [ "$stopping" = "1" ] && break

  if ! kill -0 "$child" 2>/dev/null; then
    wait "$child" 2>/dev/null
    code=$?
    ran=$(($(date +%s) - started_at))
    if [ "$ran" -lt 30 ]; then quick_exits=$((quick_exits + 1)); else quick_exits=0; fi
    if [ "$quick_exits" -ge 3 ]; then
      note "the server exited three times within 30 seconds of its start (last exit code $code). Giving up. Fix the error above, then run deploy/dev/app-start.sh $app"
      stop_children
      rm -f "$state_file"
      exit 1
    fi
    restarts=$((restarts + 1))
    note "the server exited by itself (exit code $code, after ${ran}s). Starting it again (restart $restarts)"
    stop_children
    write_state "exited with code $code"
    start_child
    continue
  fi

  # A server that just started is left alone: it is still compiling its first pages.
  ran=$(($(date +%s) - started_at))
  [ "$ran" -lt "$grace_seconds" ] && continue
  [ "$memory_guard" = "on" ] || continue
  used="$(group_rss_mb "$$")"
  reason=""
  if [ "$used" -ge "$hard_mb" ]; then
    reason="it uses ${used} MB, twice its ${cap_mb} MB budget"
  elif [ "$used" -ge "$cap_mb" ] && [ "$(quiet_for)" -ge "$quiet_seconds" ]; then
    reason="it uses ${used} MB, over its ${cap_mb} MB budget, and no request came in for ${quiet_seconds}s"
  else
    free="$(mem_available_mb)"
    if [ -n "$free" ] && [ "$free" -lt "$min_free_mb" ] && [ "$used" -ge $((cap_mb / 3)) ] && biggest_app; then
      reason="the machine has only ${free} MB of memory left and this is the biggest dev server (${used} MB)"
    fi
  fi
  if [ -n "$reason" ]; then
    # A server that is over its budget again minutes after a restart does not fit in that budget
    # at all. Restarting it for ever would be worse than letting it run: say so once, and stop.
    if [ "$ran" -lt $((grace_seconds * 3)) ]; then young_restarts=$((young_restarts + 1)); else young_restarts=0; fi
    if [ "$young_restarts" -ge 3 ]; then
      memory_guard=off
      note "the server was over its budget three times in a row within minutes of a restart (now ${used} MB of ${cap_mb} MB). The budget is too small for this app, so it is no longer restarted for memory. Give it more with KITSTAK_DEV_MEM_MB_$(printf '%s' "$app" | tr '[:lower:]' '[:upper:]')=<MB> deploy/dev/app-start.sh $app"
      write_state "budget too small, memory restarts switched off"
      continue
    fi
    restarts=$((restarts + 1))
    note "restarting the server: $reason (restart $restarts). Pages answer again in about a minute"
    stop_children
    write_state "$reason"
    start_child
  fi
done
on_stop
