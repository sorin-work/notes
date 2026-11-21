#!/bin/sh
# Database backups for notes. Runs in the postgres image, which already has
# pg_dump and pg_restore, and connects with the usual PG* variables (PGHOST,
# PGUSER, PGPASSWORD, PGDATABASE).
#
#   backup.sh                  dump once a day until stopped (the compose service)
#   backup.sh once             dump now and exit
#   backup.sh restore <file>   replace the database with a dump
#   backup.sh health           whether the last good dump is recent, for the healthcheck
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
#
# With BACKUP_ENCRYPT_TO set to one or more age public keys, the dump and the
# files archive go through age as they are written and end in .age. No plain
# copy is ever on disk. A restore of an .age file decrypts as it reads, with
# the key in $BACKUP_IDENTITY_FILE. A plain and an encrypted file of the same
# time are the same dump: they are counted, kept and pruned together.
#
# After every good dump the time is written to $BACKUP_DIR/.last-good-dump,
# BACKUP_COPY_COMMAND (if set) gets the new files as arguments, and a failure
# of either kind goes to BACKUP_ALERT_URL (if set) as a POST.
set -eu

dir=${BACKUP_DIR:-/backups}
files_dir=${ATTACHMENTS_DIR:-}
ATTACHMENT_NAME='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
keep=${BACKUP_KEEP:-7}
interval=${BACKUP_INTERVAL_SECONDS:-86400}
encrypt_to=${BACKUP_ENCRYPT_TO:-}
identity=${BACKUP_IDENTITY_FILE:-/run/secrets/backup-identity}
copy_command=${BACKUP_COPY_COMMAND:-}
copy_timeout=${BACKUP_COPY_TIMEOUT_SECONDS:-3600}
alert_url=${BACKUP_ALERT_URL:-}
marker="$dir/.last-good-dump"
DUMP_NAME='^notes-[0-9]{8}T[0-9]{6}Z\.dump(\.age)?$'

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
  if [ -n "$encrypt_to" ]; then
    command -v age >/dev/null || fail "BACKUP_ENCRYPT_TO is set, but there is no age here"
    # A key that age does not take would otherwise only show at the first dump.
    printf '' | seal /dev/null || fail "age does not take BACKUP_ENCRYPT_TO as public keys: '$encrypt_to'"
  fi
  if [ -n "$copy_command" ]; then
    is_positive_integer "$copy_timeout" || fail "BACKUP_COPY_TIMEOUT_SECONDS must be a whole number above zero, got '$copy_timeout'"
  fi
  if [ -n "$alert_url" ]; then
    command -v curl >/dev/null || fail "BACKUP_ALERT_URL is set, but there is no curl here"
  fi
}

# Writes what comes in to the file $1, encrypted to every key in
# $BACKUP_ENCRYPT_TO.
seal() {
  out=$1
  set --
  for key in $encrypt_to; do
    set -- "$@" -r "$key"
  done
  age "$@" -o "$out"
}

# Runs the command "$2 ..." and seals what it prints into $1. Fails when
# either the command or age fails, since a shell pipeline only reports the
# last of them.
sealed() {
  target=$1
  shift
  { "$@"; echo $? >"$target.status"; } | seal "$target"
  sealed_status=$?
  made_status=$(cat "$target.status" 2>/dev/null || echo 1)
  rm -f "$target.status"
  [ "$sealed_status" = 0 ] && [ "$made_status" = 0 ]
}

# A POST to BACKUP_ALERT_URL with the text $2, at most once an hour for each
# kind of failure $1 (dump or copy) while it keeps failing. The loop tries a
# failed dump again every minute, and one message a minute is noise. Never
# fails: an alert that does not go out is only logged.
alert() {
  [ -n "$alert_url" ] || return 0
  alert_now=$(date +%s)
  eval "alerted=\${alerted_$1:-}"
  if [ -n "$alerted" ] && [ "$alerted" -le "$alert_now" ] && [ $((alert_now - alerted)) -lt 3600 ]; then
    return 0
  fi
  eval "alerted_$1=$alert_now"
  # The address is not logged: it often holds a token.
  if ! curl -fsS -m 30 -X POST -H 'Title: notes backup' --data-binary "$2" "$alert_url" >/dev/null; then
    log "could not send the alert to BACKUP_ALERT_URL" >&2
  fi
}

# After a kind of failure is over, the next one is sent at once.
alert_over() {
  eval "alerted_$1="
}

# File names of the finished dumps, plain and encrypted, newest first,
# going by the time in the name.
dumps() {
  ls -1 "$dir" | grep -E "$DUMP_NAME" | sort -r
}

# A dump's name without .dump or .dump.age: notes-<time>.
stem_of() {
  echo "$1" | sed -E 's/\.dump(\.age)?$//'
}

# The dumps, one line per time, newest first. A plain and an encrypted file
# of the same time are one dump.
stems() {
  dumps | sed -E 's/\.dump(\.age)?$//' | uniq
}

# The time in a dump's name, or in its stem, as seconds since 1970. Prints nothing when the
# name does not hold a real date.
#
# Whether "date" refuses a day that does not exist depends on whose "date"
# it is. The one in the image this runs in (busybox) turns 31 February into
# 3 March. So the seconds are turned back into a name, and the date counts
# only when the name comes back as it was written.
dump_time() {
  timed=$(stem_of "$1")
  written=$(echo "$timed" | sed -E 's/^notes-(....)(..)(..)T(..)(..)(..)Z$/\1-\2-\3 \4:\5:\6/')
  read_as=$(date -u -d "$written" +%s 2>/dev/null) || return 0
  [ "$(date -u -d "@$read_as" +notes-%Y%m%dT%H%M%SZ 2>/dev/null)" = "$timed" ] || return 0
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

# The other dumps, newest first, by their stems.
present_stems() {
  stems | while read -r candidate; do
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

# The files archive that goes with a dump: .files.tar beside a .dump, and
# .files.tar.age beside a .dump.age.
files_of() {
  case $1 in
    *.dump.age) echo "${1%.dump.age}.files.tar.age" ;;
    *) echo "${1%.dump}.files.tar" ;;
  esac
}

# Removes the oldest dumps until $keep are left. Two kinds are never removed:
#
#   - Dumps dated in the future. They sort first, so counting them would let
#     a few stale files use up the quota while every new dump pushes out
#     yesterday's. They do not count towards $keep either.
#   - The dump that was just written ($1, its stem), whatever the clock
#     makes of it.
#
# Everything of an old dump goes together: the plain and the encrypted dump
# and both kinds of archive.
prune() {
  # Not "now": that is the loop's, which goes by when a dump was started.
  pruned_at=$(date +%s)
  present_stems "$pruned_at" | grep -v -x -F "$1" | tail -n +"$keep" | while read -r old; do
    for suffix in .dump .dump.age .files.tar .files.tar.age; do
      if [ -e "$dir/$old$suffix" ]; then
        rm -f "$dir/$old$suffix"
        log "removed $old$suffix"
      fi
    done
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
  if [ -n "$encrypt_to" ]; then
    sealed "$1" tar -cf - -C "$files_dir" --no-recursion . -T "$list" || status=1
  else
    tar -cf "$1" -C "$files_dir" --no-recursion . -T "$list" || status=$?
  fi
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
#
# With BACKUP_ENCRYPT_TO, pg_dump and tar write into age, and only what age
# writes reaches the disk. If either fails, the partial file goes.
dump() {
  stem="notes-$(date -u +%Y%m%dT%H%M%SZ)"
  name="$stem.dump${encrypt_to:+.age}"
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
  if [ -n "$encrypt_to" ]; then
    sealed "$partial" pg_dump --format=custom && dumped=0 || dumped=1
  else
    pg_dump --format=custom --file="$partial" && dumped=0 || dumped=1
  fi
  if [ "$dumped" != 0 ]; then
    rm -f "$partial" "$files_partial"
    partial=''
    files_partial=''
    log "pg_dump${encrypt_to:+ or age} failed" >&2
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
  mark_good "$(dump_time "$stem")" "$name"
  prune "$stem"
  if [ -n "$files_dir" ]; then
    copy_off_site "$dir/$name" "$dir/$(files_of "$name")"
  else
    copy_off_site "$dir/$name"
  fi
}

# For the healthcheck: the time of the dump $2, by the clock it was named
# with ($1, as in its name), and its name, so that the check can tell when
# the file has gone.
mark_good() {
  { echo "$1 $2" >"$marker.partial" && mv "$marker.partial" "$marker"; } || log "could not write $marker" >&2
}

# Runs BACKUP_COPY_COMMAND with the files of the dump just written as its
# arguments, in "$@". A copy that fails or takes longer than
# BACKUP_COPY_TIMEOUT_SECONDS is not a failed dump: the dump is there and
# counts. It is logged and alerted, and the next dump is copied as usual.
#
# The copy runs in a session of its own, and so does the watchdog that stops
# it. A command is often more than one process (a loop over the files, rsync
# and its ssh), and killing only the shell that runs it would leave the rest
# going, beside the next copy and while old dumps are pruned. So a timeout
# signals the whole session, and so does the end of the copy, for anything
# it left behind.
copy_off_site() {
  [ -n "$copy_command" ] || return 0
  setsid sh -c "$copy_command" copy "$@" &
  copy_pid=$!
  # The watchdog leaves a file behind when it fires, to tell a timeout from a failure.
  fired=$(mktemp)
  rm -f "$fired"
  setsid sh -c 'sleep "$1" && : >"$3" && kill -TERM -"$2" 2>/dev/null' watchdog "$copy_timeout" "$copy_pid" "$fired" &
  watchdog_pid=$!
  copied=0
  wait "$copy_pid" || copied=$?
  # The session, and the process itself in case it has not made its session
  # yet: a copy that is done at once can be quicker than that.
  kill -TERM -"$watchdog_pid" 2>/dev/null || true
  kill -TERM "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true
  stop_session "$copy_pid"
  if [ -e "$fired" ]; then
    rm -f "$fired"
    log "BACKUP_COPY_COMMAND took longer than ${copy_timeout}s for $(basename "$1") and was stopped. The dump itself is fine." >&2
    alert copy "notes backup: the copy of $(basename "$1") took longer than ${copy_timeout}s and was stopped. The dump itself was written."
  elif [ "$copied" = 0 ]; then
    log "copied $(basename "$1") off site"
    alert_over copy
  else
    log "BACKUP_COPY_COMMAND failed (exit $copied) for $(basename "$1"). The dump itself is fine." >&2
    alert copy "notes backup: the copy of $(basename "$1") failed (exit $copied). The dump itself was written."
  fi
}

# Ends whatever is left in the session $1, and waits until it is gone: up
# to ten seconds after TERM, then KILL.
stop_session() {
  kill -TERM -"$1" 2>/dev/null || return 0
  tries=0
  while kill -0 -"$1" 2>/dev/null; do
    tries=$((tries + 1))
    if [ "$tries" -gt 10 ]; then
      kill -KILL -"$1" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done
}

# When the newest dump was made, as seconds since 1970, for a clock that
# reads $1. Dumps dated after that are skipped: the clock was set back since
# they were made, so they say nothing about the age of the newest real one.
# Prints nothing when no dump is left to go by.
newest_dump_time() {
  stems | while read -r candidate; do
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
  rm -f "$dir"/.notes-*.partial "$dir"/.notes-*.partial.status
  log "dumping $PGDATABASE to $dir every ${interval}s, keeping the newest $keep${encrypt_to:+, encrypted with age}"

  now=$(date +%s)
  warn_about_future_dumps "$now"
  last=$(newest_dump_time "$now")
  if [ -z "$last" ] && [ -n "$(dumps | head -n 1)" ]; then
    log "every dump in $dir is dated in the future, counting the newest as made now"
    last=$now
  fi
  # Dumps from before there was a marker count for the healthcheck too.
  if [ ! -f "$marker" ] && [ -n "$last" ]; then
    newest=$(present_stems "$now" | head -n 1)
    if [ -n "$newest" ]; then
      newest=$(dumps | grep -F "$newest." | head -n 1)
    else
      newest=$(dumps | head -n 1)
    fi
    mark_good "$last" "$newest"
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
      alert_over dump
    else
      log "dump failed, trying again in ${step}s"
      alert dump "notes backup: a dump of $PGDATABASE failed. It is tried again every ${step}s, see docker compose logs backup."
    fi
    nap "$step"
  done
}

# For the healthcheck of the compose service: healthy when the last good
# dump is at most an interval and a bit old. The bit is a twelfth of the
# interval, two hours for a day, and at least five minutes, which leaves a
# failed dump time for a few more tries before anyone is told. A time ahead
# of the clock counts as now, the same as in the loop.
health() {
  is_positive_integer "$interval" || fail "BACKUP_INTERVAL_SECONDS must be a whole number above zero, got '$interval'"
  if [ ! -f "$marker" ]; then
    echo "no good dump yet: there is no $marker"
    exit 1
  fi
  made=$(cut -d ' ' -f 1 <"$marker")
  made_name=$(cut -s -d ' ' -f 2 <"$marker")
  if ! is_positive_integer "$made" || [ -z "$made_name" ]; then
    echo "$marker does not hold a time and a dump"
    exit 1
  fi
  if [ ! -f "$dir/$made_name" ]; then
    echo "the last good dump, $made_name, is no longer in $dir"
    exit 1
  fi
  checked_at=$(date +%s)
  grace=$((interval / 12 > 300 ? interval / 12 : 300))
  [ "$made" -le "$checked_at" ] || made=$checked_at
  since=$((checked_at - made))
  if [ "$since" -gt $((interval + grace)) ]; then
    echo "the last good dump is ${since}s old, more than ${interval}s and ${grace}s to spare"
    exit 1
  fi
  echo "the last good dump is ${since}s old"
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
# in use, after checking it. Nothing in use is touched yet. An encrypted
# archive is decrypted on the way in, so its plain copy is only ever in the
# folder the files go back to, and only until they are unpacked.
stage_files() {
  check="$files_dir/.checking.tar"
  case $1 in
    *.age)
      if ! age -d -i "$identity" -o "$check" "$1"; then
        rm -f "$check"
        fail "could not decrypt $(basename "$1") with $identity. Nothing was restored."
      fi
      ;;
    *) cp "$1" "$check" ;;
  esac
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

# Loads the dump $1 into the database $2. An encrypted dump is decrypted as
# pg_restore reads it, through a pipe, so no plain copy is written. Fails
# when age or pg_restore does.
load() {
  case $1 in
    *.age)
      # Not in the backup folder: a restore needs no folder it can write to.
      work_status=$(mktemp)
      { age -d -i "$identity" "$1"; echo $? >"$work_status"; } | pg_restore --exit-on-error --no-owner --dbname="$2"
      restored=$?
      decrypted=$(cat "$work_status" 2>/dev/null || echo 1)
      rm -f "$work_status"
      [ "$restored" = 0 ] && [ "$decrypted" = 0 ]
      ;;
    *) pg_restore --exit-on-error --no-owner --dbname="$2" "$1" ;;
  esac
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
  case $file in
    *.age)
      command -v age >/dev/null || fail "$(basename "$file") is encrypted, and there is no age here"
      [ -r "$identity" ] || fail "$(basename "$file") is encrypted. Mount the age key that can read it at $identity (or set BACKUP_IDENTITY_FILE). Nothing was restored."
      ;;
  esac

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
  if ! load "$file" "$incoming"; then
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
    if ! dump; then
      alert dump "notes backup: a dump of $PGDATABASE failed (backup.sh once)."
      fail "dump failed"
    fi
    ;;
  health)
    health
    ;;
  restore)
    shift
    restore "$@"
    ;;
  *)
    echo "usage: backup.sh [run | once | restore <file> | health]" >&2
    exit 1
    ;;
esac
