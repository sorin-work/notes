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
#
# The time in the name is the only time that counts, for the age of a dump
# and for the order they are pruned in. Modification times are not looked
# at: on a network share they come from another machine's clock. Dumps
# dated in the future are never removed and do not count towards
# $BACKUP_KEEP. Every run names them in a warning.
set -eu

dir=${BACKUP_DIR:-/backups}
keep=${BACKUP_KEEP:-7}
interval=${BACKUP_INTERVAL_SECONDS:-86400}

# A dump holds every note and the password hashes: owner only.
umask 077

# What pg_dump, pg_restore and psql call themselves on the server, so that a
# restore that finds the database busy can say who is in the way.
export PGAPPNAME="${PGAPPNAME:-notes-backup}"

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

need_database() {
  [ -n "${PGDATABASE:-}" ] || fail "PGDATABASE is not set"
}

# For the two commands that write dumps. A restore only reads one.
check_settings() {
  is_positive_integer "$keep" || fail "BACKUP_KEEP must be a whole number above zero, got '$keep'"
  is_positive_integer "$interval" || fail "BACKUP_INTERVAL_SECONDS must be a whole number above zero, got '$interval'"
  need_database
  if [ ! -d "$dir" ] || [ ! -w "$dir" ]; then
    fail "cannot write to $dir"
  fi
}

# File names of the finished dumps, newest first, going by the time in the
# name.
dumps() {
  ls -1 "$dir" | grep -E '^notes-[0-9]{8}T[0-9]{6}Z\.dump$' | sort -r
}

# The time in a dump's name as seconds since 1970. Prints nothing when the
# name does not hold a real date.
#
# Whether "date" refuses a day that does not exist depends on whose "date"
# it is. The one in the image this runs in (busybox) turns 31 February into
# 3 March. So the seconds are turned back into a name, and the date counts
# only when the name comes back as it was written.
dump_time() {
  written=$(echo "$1" | sed -E 's/^notes-(....)(..)(..)T(..)(..)(..)Z\.dump$/\1-\2-\3 \4:\5:\6/')
  read_as=$(date -u -d "$written" +%s 2>/dev/null) || return 0
  [ "$(date -u -d "@$read_as" +notes-%Y%m%dT%H%M%SZ.dump 2>/dev/null)" = "$1" ] || return 0
  echo "$read_as"
}

# Dumps whose name says they were made after the moment $1 (seconds since
# 1970). Only a clock that was wrong, then or now, explains those. A name
# that holds no real date is listed with them: its age cannot be told.
future_dumps() {
  dumps | while read -r candidate; do
    made=$(dump_time "$candidate")
    if [ -z "$made" ] || [ "$made" -gt "$1" ]; then
      echo "$candidate"
    fi
  done
}

# The other dumps, newest first.
present_dumps() {
  dumps | while read -r candidate; do
    made=$(dump_time "$candidate")
    if [ -n "$made" ] && [ "$made" -le "$1" ]; then
      echo "$candidate"
    fi
  done
}

# Said on every run for as long as such files are there, since nothing else
# will ever remove them.
warn_about_future_dumps() {
  ahead=$(future_dumps "$1" | tr '\n' ' ')
  if [ -n "$ahead" ]; then
    log "warning: dated in the future or on a day that does not exist, so never removed and not counted towards the $keep to keep: $ahead"
    log "warning: check the clock, and delete them by hand if they are not wanted"
  fi
}

# Removes the oldest dumps until $keep are left. Two kinds are never removed:
#
#   - Dumps dated in the future. They sort first, so counting them would let
#     a few stale files use up the quota while every new dump pushes out
#     yesterday's. They do not count towards $keep either.
#   - The dump that was just written ($1), whatever the clock makes of it.
prune() {
  # Not "now": that is the loop's, which goes by when a dump was started.
  pruned_at=$(date +%s)
  present_dumps "$pruned_at" | grep -v -x -F "$1" | tail -n +"$keep" | while read -r old; do
    rm -f "$dir/$old"
    log "removed $old"
  done
  warn_about_future_dumps "$pruned_at"
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
  prune "$name"
}

# When the newest dump was made, as seconds since 1970, for a clock that
# reads $1. Dumps dated after that are skipped: the clock was set back since
# they were made, so they say nothing about the age of the newest real one.
# Prints nothing when no dump is left to go by.
newest_dump_time() {
  dumps | while read -r candidate; do
    made=$(dump_time "$candidate")
    if [ -n "$made" ] && [ "$made" -le "$1" ]; then
      echo "$made"
      break
    fi
  done
}

# Sleeps in the background so that "docker compose stop" is not kept waiting.
nap() {
  sleep "$1" &
  wait $!
}

# The daily loop. What it has to get right, because getting it wrong deletes
# backups: a dump followed at once by another dump prunes one old dump per
# round until the history is gone.
#
#   - "last" is when the newest dump was made. It is read from the file names
#     once, at the start. After that it is only ever set to the current time,
#     so nothing on disk and no change of the clock can make a dump look
#     overdue twice in a row.
#   - A dump dated in the future counts as made now, never as overdue.
#   - After every attempt, whether it worked or not, there is a pause before
#     the next one.
#   - The wait is slept in steps of at most a minute, with a look at the clock
#     after each. One long sleep would not count the time a laptop spends
#     suspended, and the dumps would come less often than daily.
run() {
  check_settings
  trap 'rm -f "$partial"; log "stopping"; exit 0' TERM INT
  step=$((interval < 60 ? interval : 60))
  # Left behind if the last run was killed in the middle of a dump.
  rm -f "$dir"/.notes-*.partial
  log "dumping $PGDATABASE to $dir every ${interval}s, keeping the newest $keep"

  now=$(date +%s)
  warn_about_future_dumps "$now"
  last=$(newest_dump_time "$now")
  if [ -z "$last" ] && [ -n "$(dumps | head -n 1)" ]; then
    log "every dump in $dir is dated in the future, counting the newest as made now"
    last=$now
  fi

  while true; do
    now=$(date +%s)
    if [ -n "$last" ]; then
      # The clock was set back since the last dump.
      [ "$last" -le "$now" ] || last=$now
      left=$((interval - (now - last)))
      if [ "$left" -gt 0 ]; then
        nap "$((left < step ? left : step))"
        continue
      fi
    fi
    # On a new stack this starts before the api has created the tables.
    tables=$(psql -AtXq -c "select count(*) from pg_tables where schemaname not in ('pg_catalog', 'information_schema')" 2>/dev/null) || tables=unknown
    if [ "$tables" = 0 ]; then
      log "$PGDATABASE has no tables yet, looking again in ${step}s"
    elif dump; then
      last=$now
    else
      log "dump failed, trying again in ${step}s"
    fi
    nap "$step"
  done
}

# dropdb without the notice it prints when there is nothing to drop.
drop() {
  PGOPTIONS='-c client_min_messages=warning' dropdb --if-exists "$1"
}

database_exists() {
  found=$(
    psql -AtXq -d postgres -v name="$1" <<'SQL'
select count(*) from pg_database where datname = :'name'
SQL
  )
  [ "$found" = 1 ]
}

# Who is connected to a database, by the name each client gave: "notes-api (3), notes-backup (1)".
# Only clients count. The server's own workers, such as autovacuum, show up
# in pg_stat_activity too, have no name and go away by themselves.
connected_to() {
  psql -AtXq -d postgres -v name="$1" <<'SQL' 2>/dev/null | tr '\n' ',' | sed 's/,$//; s/,/, /g'
select coalesce(nullif(application_name, ''), 'a client without a name') || ' (' || count(*) || ')'
from pg_stat_activity
where datname = :'name' and backend_type = 'client backend' and pid <> pg_backend_pid()
group by application_name
order by application_name
SQL
}

# Replaces $PGDATABASE with a dump, in an order that never leaves the server
# without a database of that name:
#
#   1. Load the dump into <name>_restoring. A damaged dump stops here.
#   2. In one transaction, rename the current database to <name>_replaced
#      and <name>_restoring to <name>. Either both happen or neither.
#   3. Drop <name>_replaced.
#
# Killed before step 2 commits, the current database is untouched. Killed
# after, the restore is done and an old copy is left to drop. There is no
# point at which the name is free, which matters because the API would fill
# a missing database with an empty one and the backups would follow.
restore() {
  need_database
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
  replaced="${PGDATABASE}_replaced"
  # Either can be left over from a restore that was cut short.
  drop "$incoming"
  if database_exists "$replaced"; then
    log "removing $replaced, the old database an earlier restore left behind"
    drop "$replaced" || fail "could not remove $replaced. $PGDATABASE was left as it was."
  fi

  createdb "$incoming"
  if ! pg_restore --exit-on-error --no-owner --dbname="$incoming" "$file"; then
    drop "$incoming"
    fail "could not restore $(basename "$file"), $PGDATABASE was left as it was"
  fi

  swap="ALTER DATABASE \"$incoming\" RENAME TO \"$PGDATABASE\";"
  if database_exists "$PGDATABASE"; then
    swap="ALTER DATABASE \"$PGDATABASE\" RENAME TO \"$replaced\"; $swap"
  fi
  if ! psql -qX -v ON_ERROR_STOP=1 --single-transaction -d postgres -c "$swap"; then
    # Nothing was renamed: the two renames stand or fall together.
    who=$(connected_to "$PGDATABASE")
    drop "$incoming"
    log "could not put the restored copy in the place of $PGDATABASE. $PGDATABASE was left as it was." >&2
    if [ -n "$who" ]; then
      log "A database cannot be renamed while something is connected to it. Connected now: $who." >&2
      log "Stop those (with the compose stack: the api and the backup service) and try again." >&2
    fi
    exit 1
  fi

  # The restore has happened. What follows is tidying up.
  if database_exists "$replaced" && ! drop "$replaced"; then
    log "restored $PGDATABASE from $(basename "$file")"
    log "warning: the database it replaced could not be dropped and is still there as $replaced" >&2
    log "warning: to remove it: dropdb ${PGUSER:+-U $PGUSER }$replaced" >&2
    return
  fi
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
