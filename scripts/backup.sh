#!/bin/sh
# Database backups for notes. Runs in the postgres image, which already has
# pg_dump and pg_restore, and connects with the usual PG* variables (PGHOST,
# PGUSER, PGPASSWORD, PGDATABASE).
#
#   backup.sh                  dump once a day until stopped (the compose service)
#   backup.sh once             dump now and exit
#   backup.sh restore <file>   replace the database with a dump
#
# Dumps go to $BACKUP_DIR as notes-<UTC time>.dump in pg_dump's custom
# format. After every dump only the newest $BACKUP_KEEP are kept.
set -eu

dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP:-7}
interval=${BACKUP_INTERVAL_SECONDS:-86400}

# A dump holds every note and the password hashes: owner only.
umask 077

# The dump being written, if any, so that it can be removed when stopped.
partial=''

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

fail() {
  log "$*" >&2
  exit 1
}

is_positive_integer() {
  case $1 in
    '' | 0* | *[!0-9]*) return 1 ;;
  esac
}

check_settings() {
  is_positive_integer "$keep" || fail "BACKUP_KEEP must be a whole number above zero, got '$keep'"
  is_positive_integer "$interval" || fail "BACKUP_INTERVAL_SECONDS must be a whole number above zero, got '$interval'"
  [ -n "${PGDATABASE:-}" ] || fail "PGDATABASE is not set"
  if [ ! -d "$dir" ] || [ ! -w "$dir" ]; then
    fail "cannot write to $dir"
  fi
}

# File names of the finished dumps, newest first. The name sorts by time.
dumps() {
  ls -1 "$dir" | grep -E '^notes-[0-9]{8}T[0-9]{6}Z\.dump$' | sort -r
}

prune() {
  dumps | tail -n +"$((keep + 1))" | while read -r old; do
    rm -f "$dir/$old"
    log "removed $old"
  done
}

# pg_dump writes to a hidden .partial file that is renamed when it is
# complete, so a dump that was cut short never counts as a backup. Every
# step is checked by hand because "set -e" is off inside "if dump".
dump() {
  name="notes-$(date -u +%Y%m%dT%H%M%SZ).dump"
  partial="$dir/.$name.partial"
  if ! pg_dump --format=custom --file="$partial"; then
    rm -f "$partial"
    partial=''
    return 1
  fi
  # Docker runs this as root. Give the dump to whoever owns the folder, so
  # that on the host it belongs to the same user as the folder it is in.
  if [ "$(id -u)" = 0 ]; then
    chown "$(stat -c %u:%g "$dir")" "$partial" 2>/dev/null || true
  fi
  mv "$partial" "$dir/$name" || return 1
  partial=''
  log "wrote $name ($(wc -c <"$dir/$name") bytes)"
  prune
}

# Seconds until the next dump is due: one interval after the newest dump.
# Going by the files rather than by a timer means a restart does not add an
# extra dump, and a machine that was off catches up when it comes back.
seconds_until_due() {
  newest=$(dumps | head -n 1)
  if [ -z "$newest" ]; then
    echo 0
    return
  fi
  written=$(stat -c %Y "$dir/$newest" 2>/dev/null) || written=0
  age=$(($(date +%s) - written))
  if [ "$age" -lt 0 ] || [ "$age" -ge "$interval" ]; then
    echo 0
  else
    echo $((interval - age))
  fi
}

# Sleeps in the background so that "docker compose stop" is not kept waiting.
nap() {
  sleep "$1" &
  wait $!
}

run() {
  check_settings
  trap 'rm -f "$partial"; log "stopping"; exit 0' TERM INT
  # Pause after a failed dump, and while the database has no tables yet.
  retry=$((interval < 60 ? interval : 60))
  # Left behind if the last run was killed in the middle of a dump.
  rm -f "$dir"/.notes-*.partial
  log "dumping $PGDATABASE to $dir every ${interval}s, keeping the newest $keep"
  while true; do
    pause=$(seconds_until_due)
    if [ "$pause" -gt 0 ]; then
      nap "$pause"
      continue
    fi
    # On a new stack this starts before the api has created the tables.
    tables=$(psql -AtXq -c "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')" 2>/dev/null) || tables=unknown
    if [ "$tables" = 0 ]; then
      log "$PGDATABASE has no tables yet, looking again in ${retry}s"
      nap "$retry"
      continue
    fi
    if ! dump; then
      log "dump failed, trying again in ${retry}s"
      nap "$retry"
    fi
  done
}

# dropdb without the notice it prints when there is nothing to drop.
drop() {
  PGOPTIONS='-c client_min_messages=warning' dropdb --if-exists "$1"
}

# Restores into a new database first and swaps it in only when that worked,
# so a damaged dump cannot take the current data with it.
restore() {
  check_settings
  file=${1:-}
  if [ -z "$file" ]; then
    echo "usage: restore <file>" >&2
    echo "dumps in $dir, newest first:" >&2
    dumps >&2
    exit 1
  fi
  [ -f "$file" ] || file="$dir/$file"
  [ -f "$file" ] || fail "no such dump: $1"

  incoming="${PGDATABASE}_restoring"
  drop "$incoming"
  createdb "$incoming"
  if ! pg_restore --exit-on-error --no-owner --dbname="$incoming" "$file"; then
    drop "$incoming"
    fail "could not restore $(basename "$file"), $PGDATABASE was left as it was"
  fi
  if ! drop "$PGDATABASE"; then
    drop "$incoming"
    fail "could not replace $PGDATABASE, something is still connected to it. It was left as it was. Stop the api and try again."
  fi
  psql -qX -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE \"$incoming\" RENAME TO \"$PGDATABASE\""
  log "restored $PGDATABASE from $(basename "$file")"
}

case ${1:-run} in
  run)
    run
    ;;
  once)
    check_settings
    dump || fail "dump failed"
    ;;
  restore)
    shift
    restore "$@"
    ;;
  *)
    echo "usage: backup.sh [run | once | restore <file>]" >&2
    exit 1
    ;;
esac
