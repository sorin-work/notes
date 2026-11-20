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
# With ATTACHMENTS_DIR set, the files of attachments go beside each dump as
# notes-<UTC time>.files.tar, made just before the dump, and a restore puts
# them back with it. Only regular files named like an attachment id are
# taken, never a link; a restore refuses an archive that holds anything else,
# and refuses to touch the files while the API is running.
#
# The time in the name is the only time that counts, for the age of a dump
# and for the order they are pruned in. Modification times are not looked
# at: on a network share they come from another machine's clock. Dumps
# dated in the future are never removed and do not count towards
# $BACKUP_KEEP. Every run names them in a warning.
set -eu

dir=${BACKUP_DIR:-/backups}
files_dir=${ATTACHMENTS_DIR:-}
ATTACHMENT_NAME='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
keep=${BACKUP_KEEP:-7}
interval=${BACKUP_INTERVAL_SECONDS:-86400}

# A dump holds every note and the password hashes: owner only.
umask 077

# What pg_dump, pg_restore and psql call themselves on the server, so that a
# restore that finds the database busy can say who is in the way.
export PGAPPNAME="${PGAPPNAME:-notes-backup}"

# The dump and the files archive being written, if any, so that they can be removed when stopped.
partial=''
files_partial=''

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
  if [ -n "$files_dir" ] && [ ! -d "$files_dir" ]; then
    fail "ATTACHMENTS_DIR is set, but $files_dir is not a folder"
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
# The files archive that goes with a dump.
files_of() {
  echo "${1%.dump}.files.tar"
}

prune() {
  # Not "now": that is the loop's, which goes by when a dump was started.
  pruned_at=$(date +%s)
  present_dumps "$pruned_at" | grep -v -x -F "$1" | tail -n +"$keep" | while read -r old; do
    rm -f "$dir/$old" "$dir/$(files_of "$old")"
    log "removed $old"
  done
  warn_about_future_dumps "$pruned_at"
}

# pg_dump writes to a hidden .partial file that is renamed when it is
# complete, so a dump that was cut short never counts as a backup. Every
# step is checked by hand because "set -e" is off inside "if dump".
# The files of attachments into the archive $1: regular files named like an
# attachment id, nothing else. The folder itself is the first entry, so that
# an archive with no files in it is still an archive.
archive_files() {
  list="$1.list"
  : >"$list"
  # Not "name": that is the dump's, which dump() goes on to use.
  for entry in $(ls -A "$files_dir" | grep -E "$ATTACHMENT_NAME"); do
    if [ -f "$files_dir/$entry" ] && [ ! -L "$files_dir/$entry" ]; then
      echo "$entry" >>"$list"
    fi
  done
  status=0
  tar -cf "$1" -C "$files_dir" --no-recursion . -T "$list" || status=$?
  rm -f "$list"
  return "$status"
}

# The files are archived first, the database after. A file deleted in
# between is in the archive without a row, and the API sweeps it out after
# a restore. A file uploaded in between is the other way round: its row is
# in the dump and the file is not in the archive. After a restore that note
# shows the file as missing, and the export and the JSON backup leave it out
# and list it. Without stopping the API there is no moment at which both are
# taken together; a dump of a stopped stack has no such gap.
dump() {
  name="notes-$(date -u +%Y%m%dT%H%M%SZ).dump"
  partial="$dir/.$name.partial"
  if [ -n "$files_dir" ]; then
    files_partial="$dir/.$(files_of "$name").partial"
    if ! archive_files "$files_partial"; then
      rm -f "$files_partial"
      files_partial=''
      log "could not archive the files in $files_dir" >&2
      return 1
    fi
  fi
  if ! pg_dump --format=custom --file="$partial"; then
    rm -f "$partial" "$files_partial"
    partial=''
    files_partial=''
    return 1
  fi
  # Docker runs this as root. Give the dump to whoever owns the folder, so
  # that on the host it belongs to the same user as the folder it is in.
  if [ "$(id -u)" = 0 ]; then
    chown "$(stat -c %u:%g "$dir")" "$partial" ${files_partial:+"$files_partial"} 2>/dev/null || true
  fi
  # The archive is in place before the dump, so there is never a dump without its files.
  if [ -n "$files_partial" ]; then
    mv "$files_partial" "$dir/$(files_of "$name")" || return 1
    files_partial=''
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
  trap 'rm -f "$partial" "$files_partial"; log "stopping"; exit 0' TERM INT
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
connected_to() {
  psql -AtXq -d postgres -v name="$1" <<'SQL' 2>/dev/null | tr '\n' ',' | sed 's/,$//; s/,/, /g'
select coalesce(nullif(application_name, ''), 'a client without a name') || ' (' || count(*) || ')'
from pg_stat_activity
where datname = :'name' and pid <> pg_backend_pid()
group by application_name
order by application_name
SQL
}

# Whether the archive $1 holds only what archive_files puts in: the folder
# itself and regular files named like an attachment id. No links, no other
# names, no paths, so extracting it cannot write anywhere else.
archive_is_clean() {
  # BusyBox tar lists a hard link as a regular file, with " -> target"
  # after the name; GNU tar says "link to". Either is refused here, before
  # anything else is looked at.
  if tar -tvf "$1" 2>/dev/null | grep -q -e ' -> ' -e ' link to '; then
    return 1
  fi
  tar -tf "$1" >"$1.names" 2>/dev/null || { rm -f "$1.names"; return 1; }
  tar -tvf "$1" 2>/dev/null | cut -c1 >"$1.types" || { rm -f "$1.names" "$1.types"; return 1; }
  clean=0
  if [ "$(wc -l <"$1.names")" != "$(wc -l <"$1.types")" ]; then
    clean=1
  else
    paste -d ' ' "$1.types" "$1.names" >"$1.entries"
    while read -r type entry; do
      case $type in
        d) [ "$entry" = . ] || [ "$entry" = ./ ] || clean=1 ;;
        -) echo "$entry" | grep -q -E "$ATTACHMENT_NAME" || clean=1 ;;
        *) clean=1 ;;
      esac
    done <"$1.entries"
  fi
  rm -f "$1.names" "$1.types" "$1.entries"
  return "$clean"
}

# Unpacks the files archive $1 into $files_dir/.restoring, next to the files
# in use, after checking it. Nothing in use is touched yet.
stage_files() {
  check="$files_dir/.checking.tar"
  cp "$1" "$check"
  if ! archive_is_clean "$check"; then
    rm -f "$check"
    fail "$(basename "$1") holds something other than attachment files. Nothing was restored."
  fi
  incoming_files="$files_dir/.restoring"
  rm -rf "$incoming_files"
  mkdir "$incoming_files"
  if ! tar -xof "$check" -C "$incoming_files"; then
    rm -rf "$incoming_files" "$check"
    fail "could not unpack $(basename "$1"). Nothing was restored."
  fi
  rm -f "$check"
  # Whatever the listing said, what came out has to be plain files and the
  # folder: nothing else, and no file with a second name somewhere, which a
  # hard link would be. Checked before anything changes an owner.
  if [ -n "$(find "$incoming_files" -mindepth 1 \( ! -type f ! -type d \) -o \( -type f -links +1 \))" ]; then
    rm -rf "$incoming_files"
    fail "$(basename "$1") unpacked into something other than plain files. Nothing was restored."
  fi
  # The API reads and writes these files, so they belong to whoever owns the folder.
  if [ "$(id -u)" = 0 ]; then
    chown -R "$(stat -c %u:%g "$files_dir")" "$incoming_files" 2>/dev/null || true
  fi
}

# Puts the staged files in the place of the ones in use. Only files named
# like an attachment id are moved; anything else in the folder is left alone.
swap_files() {
  replaced_files="$files_dir/.replaced"
  # A .replaced left by an earlier restore that failed half way holds files
  # someone may still want. It is moved aside, not removed.
  if [ -e "$replaced_files" ]; then
    kept="$files_dir/.replaced-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "$replaced_files" "$kept"
    log "warning: $replaced_files from an earlier restore was moved to $kept. Remove it once it is not needed." >&2
  fi
  mkdir "$replaced_files"
  for entry in $(ls -A "$files_dir" | grep -E "$ATTACHMENT_NAME"); do
    mv "$files_dir/$entry" "$replaced_files/" || swap_failed "$entry"
  done
  for entry in $(ls -A "$incoming_files" | grep -E "$ATTACHMENT_NAME"); do
    mv "$incoming_files/$entry" "$files_dir/" || swap_failed "$entry"
  done
  rm -rf "$incoming_files" "$replaced_files"
}

# A file could not be moved after the database was already restored.
swap_failed() {
  log "could not move $1 while putting the restored files in place. The database is restored." >&2
  log "The files that were in use are in $replaced_files, the restored ones still in $incoming_files." >&2
  log "To go back to the old files: mv $replaced_files/* $files_dir/ (and restore the matching dump)." >&2
  log "To finish instead: mv $incoming_files/* $files_dir/ and remove $replaced_files." >&2
  exit 1
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

  # The files of attachments, when there are some to restore. They are
  # checked and unpacked aside first, and only put in place once the
  # database is.
  files=''
  if [ -n "$files_dir" ]; then
    [ -d "$files_dir" ] || fail "ATTACHMENTS_DIR is set, but $files_dir is not a folder"
    if [ -f "$(files_of "$file")" ]; then
      files=$(files_of "$file")
      # The API writes and removes files as it goes: while it runs, the folder is not ours to replace.
      who=$(connected_to "$PGDATABASE")
      case $who in
        *notes-api*)
          fail "the API is running (connected now: $who). Stop it before a restore. Nothing was restored."
          ;;
      esac
      stage_files "$files"
    else
      log "warning: there is no $(basename "$(files_of "$file")") beside the dump, so the files of attachments are left as they are" >&2
    fi
  fi

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
    [ -z "$files" ] || rm -rf "$incoming_files"
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
    [ -z "$files" ] || rm -rf "$incoming_files"
    log "could not put the restored copy in the place of $PGDATABASE. $PGDATABASE was left as it was." >&2
    if [ -n "$who" ]; then
      log "A database cannot be renamed while something is connected to it. Connected now: $who." >&2
      log "Stop those (with the compose stack: the api and the backup service) and try again." >&2
    fi
    exit 1
  fi

  # The database is restored. Its files go in now, so that rows and files are from the same moment.
  if [ -n "$files" ]; then
    swap_files
    log "restored the files of attachments from $(basename "$files")"
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
