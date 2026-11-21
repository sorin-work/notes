#!/bin/sh
# Checks the parts of backup.sh that can lose data when they go wrong: the
# daily loop, the pruning, and the order of the steps in a restore. No
# database is needed. pg_dump, psql, the other database tools and sleep are
# replaced by stand-ins, so every case takes a moment, and dump files with
# made-up dates stand for clocks that were wrong or were changed.
#
# For the loop: it runs for a number of rounds, makes at most one dump,
# pauses after every attempt, and never leaves fewer dumps behind than
# BACKUP_KEEP allows.
#
# age, curl and the copy command have stand-ins too, for encrypted dumps
# (no plain file is ever left, and a plain and an encrypted file of one time
# are one dump), copies that fail, alerts, and the healthcheck.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ROUNDS=12
DAY=86400
# The real one, for a case that needs time to pass. "sleep" is replaced below.
REAL_SLEEP=$(command -v sleep)
now=$(date +%s)
# Two days from now, in the form touch takes.
AHEAD=$(date -u -d "@$((now + 2 * DAY))" '+%Y-%m-%d %H:%M:%S')

mkdir "$work/bin"

# Writes the file pg_dump was asked for, or to its output without one,
# unless the case wants it to fail.
# With "fast-clock" the file gets a modification time in the future, as if
# the folder were on a machine whose clock runs ahead. With "slow" it takes
# as many seconds as that file says.
cat >"$work/bin/pg_dump" <<'STUB'
#!/bin/sh
echo attempt >>"$STATE/attempts"
[ ! -e "$STATE/fail" ] || exit 1
[ ! -e "$STATE/slow" ] || "$REAL_SLEEP" "$(cat "$STATE/slow")"
case "$*" in
  *--file=*) ;;
  *) echo "new" ;;
esac
for arg in "$@"; do
  case $arg in
    --file=*)
      echo "new" >"${arg#--file=}"
      [ ! -e "$STATE/fast-clock" ] || touch -d "$AHEAD" "${arg#--file=}"
      ;;
  esac
done
STUB

# The database server, for a restore, is a folder: one file per database,
# holding "original", "empty" or "restored". Every call is written down in
# $STATE/calls, so a case can say what must never have been asked for.
cat >"$work/bin/psql" <<'STUB'
#!/bin/sh
echo "psql $*" >>"$STATE/calls"
name=''
for arg in "$@"; do
  case $arg in
    name=*) name=${arg#name=} ;;
  esac
done
case "$*" in
  *"RENAME TO"*)
    # The two renames of the swap, or the one when there is nothing to replace.
    [ ! -e "$STATE/swap-fails" ] || exit 1
    echo "$*" | grep -o 'ALTER DATABASE "[^"]*" RENAME TO "[^"]*"' | while read -r _ _ from _ _ to; do
      mv "$STATE/dbs/$(echo "$from" | tr -d '"')" "$STATE/dbs/$(echo "$to" | tr -d '"')" || exit 1
    done
    ;;
  *pg_tables*)
    # The loop asking how many tables there are.
    echo 9
    ;;
  *)
    query=$(cat)
    case $query in
      *pg_stat_activity*) [ ! -e "$STATE/connected" ] || cat "$STATE/connected" ;;
      *pg_database*) if [ -e "$STATE/dbs/$name" ]; then echo 1; else echo 0; fi ;;
    esac
    ;;
esac
STUB

cat >"$work/bin/createdb" <<'STUB'
#!/bin/sh
echo "createdb $*" >>"$STATE/calls"
echo empty >"$STATE/dbs/$1"
STUB

cat >"$work/bin/dropdb" <<'STUB'
#!/bin/sh
echo "dropdb $*" >>"$STATE/calls"
for name in "$@"; do :; done
if [ -e "$STATE/drop-fails" ] && [ "$name" = "$(cat "$STATE/drop-fails")" ]; then
  exit 1
fi
rm -f "$STATE/dbs/$name"
STUB

cat >"$work/bin/pg_restore" <<'STUB'
#!/bin/sh
echo "pg_restore $*" >>"$STATE/calls"
[ ! -e "$STATE/restore-fails" ] || exit 1
input=''
for arg in "$@"; do
  case $arg in
    --dbname=*) echo restored >"$STATE/dbs/${arg#--dbname=}" ;;
    -*) ;;
    *) input=$arg ;;
  esac
done
# What it was given to load, from the file or through a pipe.
if [ -n "$input" ]; then cp "$input" "$STATE/loaded"; else cat >"$STATE/loaded"; fi
STUB
chmod +x "$work/bin/createdb" "$work/bin/dropdb" "$work/bin/pg_restore"

# age: "encrypts" by putting a line "sealed" in front, and "decrypts" by
# taking it off again, with a key file that says "key". With
# $STATE/age-fails it writes half a file and fails, for a dump only, so that
# the check of the keys at the start still passes.
cat >"$work/bin/age" <<'STUB'
#!/bin/sh
echo "age $*" >>"$STATE/calls"
out=/dev/stdout
identity=''
decrypt=''
input=/dev/stdin
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift ;;
    -r) shift ;;
    -i) identity=$2; shift ;;
    -d) decrypt=1 ;;
    *) input=$1 ;;
  esac
  shift
done
if [ -n "$decrypt" ]; then
  [ "$(cat "$identity" 2>/dev/null)" = key ] || { echo "age: no identity matched" >&2; exit 1; }
  [ "$(head -n 1 "$input")" = sealed ] || exit 1
  tail -n +2 "$input" >"$out"
  exit 0
fi
if [ -e "$STATE/age-fails" ] && [ "${out%.partial}" != "$out" ]; then
  echo sealed >"$out"
  head -c 3 >>"$out"
  exit 1
fi
{ echo sealed; cat; } >"$out"
STUB

# Takes down the text of every alert.
cat >"$work/bin/curl" <<'STUB'
#!/bin/sh
while [ $# -gt 0 ]; do
  [ "$1" != --data-binary ] || echo "$2" >>"$STATE/alerts"
  shift
done
[ ! -e "$STATE/alert-fails" ]
STUB
chmod +x "$work/bin/age" "$work/bin/curl"

# Returns at once and stops the loop, its parent, after $ROUNDS naps. With
# $STATE/real-sleep it sleeps for real and counts nothing: the watchdog of a
# copy sleeps too, and must not stop the copy at once.
cat >"$work/bin/sleep" <<'STUB'
#!/bin/sh
[ ! -e "$STATE/real-sleep" ] || exec "$REAL_SLEEP" "$@"
echo "$1" >>"$STATE/naps"
if [ "$(wc -l <"$STATE/naps")" -ge "$ROUNDS" ]; then
  kill -TERM "$PPID"
fi
STUB
chmod +x "$work/bin/pg_dump" "$work/bin/psql" "$work/bin/sleep"

fail() {
  echo "FAILED ($case_name): $*" >&2
  echo "--- dumps" >&2
  ls -l "$BACKUP_DIR" >&2
  echo "--- log" >&2
  cat "$STATE/log" >&2
  exit 1
}

# A dump file dated $1 seconds from now (negative for the past).
old_dump() {
  name="notes-$(date -u -d "@$((now + $1))" +%Y%m%dT%H%M%SZ).dump"
  echo "old" >"$BACKUP_DIR/$name"
  echo "$name"
}

begin() {
  case_name=$1
  STATE="$work/state"
  BACKUP_DIR="$work/dumps"
  rm -rf "$STATE" "$BACKUP_DIR"
  mkdir "$STATE" "$STATE/dbs" "$BACKUP_DIR"
  : >"$STATE/attempts"
  : >"$STATE/naps"
  : >"$STATE/calls"
  : >"$STATE/alerts"
  export STATE BACKUP_DIR ROUNDS AHEAD REAL_SLEEP
  export BACKUP_KEEP=3 BACKUP_INTERVAL_SECONDS=$DAY PGDATABASE=notes
  unset BACKUP_ENCRYPT_TO BACKUP_IDENTITY_FILE BACKUP_COPY_COMMAND BACKUP_ALERT_URL
}

# Runs the loop until the stand-in for sleep stops it. The timeout is for a
# loop that never pauses at all.
run_loop() {
  status=0
  PATH="$work/bin:$PATH" timeout 30 sh "$here/backup.sh" >"$STATE/log" 2>&1 || status=$?
  [ "$status" -eq 0 ] || fail "the loop did not stop by itself (exit $status), so it ran without pausing"
}

count() {
  wc -l <"$1" | tr -d ' '
}

dump_count() {
  ls "$BACKUP_DIR" | grep -c '\.dump$' || true
}

# $1: how many dumps the loop should have made, $2: how many files to find.
expect() {
  attempts=$(count "$STATE/attempts")
  [ "$attempts" -eq "$1" ] || fail "expected $1 dump(s) to be made, saw $attempts"
  [ "$(dump_count)" -eq "$2" ] || fail "expected $2 dump files, found $(dump_count)"
  [ "$(count "$STATE/naps")" -ge "$ROUNDS" ] || fail "the loop stopped before $ROUNDS pauses"
  echo "ok: $case_name"
}

begin "no dumps yet: one dump, then it waits"
run_loop
expect 1 1

begin "newest dump two days old: one dump, the oldest goes"
oldest=$(old_dump $((-4 * DAY)))
old_dump $((-3 * DAY)) >/dev/null
old_dump $((-2 * DAY)) >/dev/null
run_loop
expect 1 3
[ ! -e "$BACKUP_DIR/$oldest" ] || fail "the oldest dump was kept"

begin "newest dump an hour old: nothing to do"
old_dump $((-2 * DAY)) >/dev/null
old_dump $((-1 * DAY)) >/dev/null
old_dump -3600 >/dev/null
run_loop
expect 0 3

begin "modification times in the future, as on a share with a fast clock"
old_dump $((-2 * DAY)) >/dev/null
old_dump $((-1 * DAY)) >/dev/null
old_dump -3600 >/dev/null
touch -d "$AHEAD" "$BACKUP_DIR"/*.dump
touch "$STATE/fast-clock"
run_loop
expect 0 3

begin "the same share, with a dump that is due: one dump, not one per round"
old_dump $((-4 * DAY)) >/dev/null
old_dump $((-3 * DAY)) >/dev/null
old_dump $((-2 * DAY)) >/dev/null
touch -d "$AHEAD" "$BACKUP_DIR"/*.dump
touch "$STATE/fast-clock"
run_loop
expect 1 3

begin "every dump dated in the future, after the clock was set back"
old_dump $((1 * DAY)) >/dev/null
old_dump $((2 * DAY)) >/dev/null
old_dump $((3 * DAY)) >/dev/null
run_loop
expect 0 3
grep -q "dated in the future" "$STATE/log" || fail "the log does not mention the dates"

begin "dumps dated in the future next to an overdue one: one dump, and none of them is removed"
overdue=$(old_dump $((-2 * DAY)))
ahead=$(old_dump $((2 * DAY)))
old_dump $((3 * DAY)) >/dev/null
run_loop
# The two from the future do not count, so the overdue one and the new one are well within the three to keep.
expect 1 4
[ -e "$BACKUP_DIR/$overdue" ] || fail "a dump was removed although fewer than BACKUP_KEEP are dated in the present"
grep -lq new "$BACKUP_DIR"/*.dump || fail "the dump that was just written was pruned"
grep -q "warning: dated in the future.*$ahead" "$STATE/log" || fail "no warning names the dumps from the future"

begin "a full set of real dumps beside ones from the future: the real ones get the whole quota"
old_dump $((30 * DAY)) >/dev/null
old_dump $((31 * DAY)) >/dev/null
oldest=$(old_dump $((-4 * DAY)))
kept=$(old_dump $((-3 * DAY)))
old_dump $((-2 * DAY)) >/dev/null
run_loop
# Three dated in the present stay (the new one and the two newest before it), next to the two from the future.
expect 1 5
[ ! -e "$BACKUP_DIR/$oldest" ] || fail "the oldest present-dated dump was kept"
[ -e "$BACKUP_DIR/$kept" ] || fail "yesterday's dumps were pushed out by ones from the future"

begin "pg_dump fails: a pause after every attempt, nothing removed"
old_dump $((-4 * DAY)) >/dev/null
old_dump $((-3 * DAY)) >/dev/null
old_dump $((-2 * DAY)) >/dev/null
touch "$STATE/fail"
run_loop
[ "$(dump_count)" -eq 3 ] || fail "expected the 3 old dumps to be left alone, found $(dump_count)"
[ "$(count "$STATE/attempts")" -le "$(count "$STATE/naps")" ] || fail "two attempts without a pause in between"
[ -z "$(ls -A "$BACKUP_DIR" | grep '\.partial$' || true)" ] || fail "a partial dump was left behind"
echo "ok: $case_name"

begin "once, with every other dump dated in the future: nothing is removed, and it says so every time"
old_dump $((1 * DAY)) >/dev/null
old_dump $((2 * DAY)) >/dev/null
old_dump $((3 * DAY)) >/dev/null
PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || fail "once failed"
[ "$(dump_count)" -eq 4 ] || fail "expected the 3 future-dated dumps and the new one, found $(dump_count)"
grep -lq new "$BACKUP_DIR"/*.dump || fail "the dump that was just written was pruned"
[ "$(grep -c "warning: dated in the future" "$STATE/log")" -eq 1 ] || fail "expected one warning about the future-dated dumps"
sleep 1
PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || fail "the second once failed"
grep -q "warning: dated in the future" "$STATE/log" || fail "the warning was not repeated on the next run"
echo "ok: $case_name"

begin "a dump that takes a while: the next one is due an interval after it started, not after it ended"
# Counted from the end, every dump would come later than the one before by
# the time a dump takes, until the service is restarted.
export BACKUP_INTERVAL_SECONDS=10
echo 2 >"$STATE/slow"
ROUNDS=2
run_loop
ROUNDS=12
# The first pause follows the dump. The second is what is left of the interval.
left=$(sed -n 2p "$STATE/naps")
if [ "$(count "$STATE/attempts")" -eq 1 ]; then
  [ "$left" -le 8 ] || fail "after a dump of 2s the next was due in ${left}s of 10, so the interval was counted from the end of the dump"
fi
echo "ok: $case_name"

begin "a dump named for 31 February: no such day, so it is kept and named in the warning"
# Whether "date" refuses the day depends on whose it is. The one in the image
# the backup service runs in reads it as 3 March, two years back: the oldest
# of the lot, and the one to go.
impossible=notes-20240231T000000Z.dump
echo "old" >"$BACKUP_DIR/$impossible"
oldest=$(old_dump $((-4 * DAY)))
old_dump $((-3 * DAY)) >/dev/null
old_dump $((-2 * DAY)) >/dev/null
PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || fail "once failed"
[ -e "$BACKUP_DIR/$impossible" ] || fail "the dump with a date that does not exist was removed"
[ ! -e "$BACKUP_DIR/$oldest" ] || fail "the oldest real dump was kept, so the one from 31 February was counted"
[ "$(dump_count)" -eq 4 ] || fail "expected the new dump, two older ones and the one from 31 February, found $(dump_count)"
grep -q "warning: dated in the future or on a day that does not exist.*$impossible" "$STATE/log" || fail "no warning names the dump from 31 February"
echo "ok: $case_name"

# A restore of "notes" from $1, with whatever the case has set up. Leaves the exit status in $status.
run_restore() {
  status=0
  PATH="$work/bin:$PATH" PGUSER=notes sh "$here/backup.sh" restore "$1" >"$STATE/log" 2>&1 || status=$?
}

database() {
  cat "$STATE/dbs/$1" 2>/dev/null || echo "(none)"
}

# The current database must never be dropped by name: it is renamed aside, and only that copy is dropped.
never_dropped_by_name() {
  if grep -q -x -e "dropdb --if-exists notes" "$STATE/calls"; then
    fail "the database itself was dropped"
  fi
}

begin "restore: replaces the database in one transaction and drops the old one last"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)', not the restored data"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
swap=$(grep "RENAME TO" "$STATE/calls")
[ "$(echo "$swap" | wc -l)" -eq 1 ] || fail "the two renames were not one call: $swap"
echo "$swap" | grep -q -e "--single-transaction" || fail "the renames are not in a transaction"
echo "$swap" | grep -q 'ALTER DATABASE "notes" RENAME TO "notes_replaced"; ALTER DATABASE "notes_restoring" RENAME TO "notes";' ||
  fail "unexpected swap: $swap"
[ "$(grep -n "RENAME TO" "$STATE/calls" | cut -d: -f1)" -lt "$(grep -n "dropdb --if-exists notes_replaced" "$STATE/calls" | tail -n 1 | cut -d: -f1)" ] ||
  fail "the old database was dropped before the swap"
never_dropped_by_name
echo "ok: $case_name"

begin "restore: the dump does not load: the database is untouched"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
touch "$STATE/restore-fails"
run_restore "$dump"
[ "$status" -ne 0 ] || fail "the restore reported success"
[ "$(database notes)" = original ] || fail "notes holds '$(database notes)' after a failed restore"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
if grep -q "RENAME TO" "$STATE/calls"; then fail "a swap was attempted with a dump that did not load"; fi
never_dropped_by_name
grep -q "notes was left as it was" "$STATE/log" || fail "the message does not say the database is untouched"
echo "ok: $case_name"

begin "restore: the swap is refused: the database is untouched, and the message says who is connected"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
touch "$STATE/swap-fails"
printf 'notes-api (2)\nnotes-backup (1)\n' >"$STATE/connected"
run_restore "$dump"
[ "$status" -ne 0 ] || fail "the restore reported success"
[ "$(database notes)" = original ] || fail "notes holds '$(database notes)' after a refused swap"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
never_dropped_by_name
grep -q "notes was left as it was" "$STATE/log" || fail "the message does not say the database is untouched"
grep -q "Connected now: notes-api (2), notes-backup (1)\." "$STATE/log" || fail "the message does not say who is connected"
echo "ok: $case_name"

begin "restore: no database of that name yet"
dump=$(old_dump -3600)
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
echo "ok: $case_name"

begin "restore: the old database cannot be dropped after the swap: restored, with a warning that names it"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
echo notes_replaced >"$STATE/drop-fails"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore reported a failure although the data is in place"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(database notes_replaced)" = original ] || fail "the old database is gone although its drop failed"
grep -q "still there as notes_replaced" "$STATE/log" || fail "no warning about the database that was left"
grep -q "dropdb -U notes notes_replaced" "$STATE/log" || fail "the warning does not say how to remove it"
echo "ok: $case_name"

begin "restore: an old database left by an earlier restore is removed first"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
echo older >"$STATE/dbs/notes_replaced"
echo half >"$STATE/dbs/notes_restoring"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
grep -q "removing notes_replaced" "$STATE/log" || fail "it does not say that it removed the leftover"
echo "ok: $case_name"

begin "restore: needs no backup folder it can write to, or one at all"
dump=$(old_dump -3600)
mv "$BACKUP_DIR/$dump" "$STATE/elsewhere.dump"
echo original >"$STATE/dbs/notes"
BACKUP_DIR="$work/no-such-folder" run_restore "$STATE/elsewhere.dump"
[ "$status" -eq 0 ] || fail "the restore failed: $(cat "$STATE/log")"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
echo "ok: $case_name"

# The files of attachments, beside the dumps.
A1=00000000-0000-4000-8000-000000000001
A2=00000000-0000-4000-8000-000000000002
A3=00000000-0000-4000-8000-000000000003

files_begin() {
  begin "$1"
  FILES="$work/files"
  rm -rf "$FILES"
  mkdir "$FILES"
  export ATTACHMENTS_DIR="$FILES"
}

archive_of() {
  echo "$BACKUP_DIR/${1%.dump}.files.tar"
}

files_begin "files: archived beside the dump, attachment files only, no links"
echo one >"$FILES/$A1"
echo two >"$FILES/$A2"
echo "not ours" >"$FILES/README"
echo half >"$FILES/.$A3.partial"
ln -s /etc/passwd "$FILES/$A3"
PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || fail "once failed"
dump=$(ls "$BACKUP_DIR" | grep '\.dump$')
[ -f "$(archive_of "$dump")" ] || fail "no files archive beside $dump"
listed=$(tar -tf "$(archive_of "$dump")" | grep -v '^\./*$' | sort | tr '\n' ' ')
[ "$listed" = "$A1 $A2 " ] || fail "the archive holds: $listed"
echo "ok: $case_name"

files_begin "files: an empty folder still gives an archive, and pruning takes the archive with its dump"
oldest=$(old_dump $((-4 * DAY)))
: >"$(archive_of "$oldest")"
old_dump $((-3 * DAY)) >/dev/null
old_dump $((-2 * DAY)) >/dev/null
PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || fail "once failed"
[ ! -e "$BACKUP_DIR/$oldest" ] || fail "the oldest dump was kept"
[ ! -e "$(archive_of "$oldest")" ] || fail "the archive of the pruned dump was kept"
newest=$(ls "$BACKUP_DIR" | grep '\.dump$' | sort | tail -n 1)
tar -tf "$(archive_of "$newest")" >/dev/null || fail "the archive of an empty folder is not an archive"
echo "ok: $case_name"

# An archive the way the backup makes it, from what is in $work/source.
make_archive() {
  tar -cf "$1" -C "$work/source" --no-recursion . $(ls -A "$work/source")
}

files_begin "files: a restore puts the archived files in place of the ones in use, after the database"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
rm -rf "$work/source" && mkdir "$work/source"
echo restored >"$work/source/$A1"
make_archive "$(archive_of "$dump")"
echo "in use" >"$FILES/$A2"
echo "not ours" >"$FILES/README"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(cat "$FILES/$A1" 2>/dev/null)" = restored ] || fail "the archived file is not in place"
[ ! -e "$FILES/$A2" ] || fail "a file from after the dump was kept"
[ "$(cat "$FILES/README")" = "not ours" ] || fail "a file that is no attachment was touched"
[ ! -e "$FILES/.restoring" ] && [ ! -e "$FILES/.replaced" ] || fail "staging folders were left behind"
echo "ok: $case_name"

files_begin "files: refused while the API is running, and nothing is touched"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
rm -rf "$work/source" && mkdir "$work/source"
echo restored >"$work/source/$A1"
make_archive "$(archive_of "$dump")"
echo "in use" >"$FILES/$A2"
printf 'notes-api (3)\n' >"$STATE/connected"
run_restore "$dump"
[ "$status" -ne 0 ] || fail "the restore went ahead while the API was running"
[ "$(database notes)" = original ] || fail "notes holds '$(database notes)'"
[ "$(cat "$FILES/$A2")" = "in use" ] && [ ! -e "$FILES/$A1" ] || fail "the files were touched"
if grep -q "createdb" "$STATE/calls"; then fail "the database restore was started"; fi
grep -q "the API is running" "$STATE/log" || fail "the message does not say why"
echo "ok: $case_name"

for bad in link name folder; do
  files_begin "files: an archive with a $bad in it is refused, and nothing is touched"
  dump=$(old_dump -3600)
  echo original >"$STATE/dbs/notes"
  rm -rf "$work/source" && mkdir "$work/source"
  echo restored >"$work/source/$A1"
  case $bad in
    link) ln -s /etc/passwd "$work/source/$A3" ;;
    name) echo x >"$work/source/evil.sh" ;;
    folder) mkdir "$work/source/$A3" ;;
  esac
  make_archive "$(archive_of "$dump")"
  echo "in use" >"$FILES/$A2"
  run_restore "$dump"
  [ "$status" -ne 0 ] || fail "the archive was taken"
  [ "$(database notes)" = original ] || fail "notes holds '$(database notes)'"
  [ "$(ls -A "$FILES")" = "$A2" ] || fail "the folder holds: $(ls -A "$FILES" | tr '\n' ' ')"
  grep -q "holds something other than attachment files" "$STATE/log" || fail "the message does not say why"
  echo "ok: $case_name"
done

# A tar archive with one hard link entry, named $2, to $3, written byte by
# byte, since no tar here makes one that points out of its folder.
field() {
  printf '%s' "$1"
  head -c $(($2 - ${#1})) /dev/zero
}
link_archive() {
  {
    field "$2" 100
    field 0000644 8
    field 0000000 8
    field 0000000 8
    field 00000000000 12
    field 00000000000 12
    printf '        '
    printf '1'
    field "$3" 100
    printf 'ustar\00000'
    head -c 247 /dev/zero
  } >"$1"
  sum=$(od -An -tu1 -v "$1" | awk '{ for (i = 1; i <= NF; i++) s += $i } END { print s }')
  printf '%06o\0 ' "$sum" | dd of="$1" bs=1 seek=148 conv=notrunc 2>/dev/null
  head -c 1024 /dev/zero >>"$1"
}

files_begin "files: an archive with a hard link to a file outside is refused, and the file outside is untouched"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
mkdir -p "$work/out"
echo victim >"$work/out/victim"
before=$(stat -c '%u:%g %h' "$work/out/victim")
# The way the files folder and the outside file sit next to each other: <work>/files/.restoring/<id> -> ../../out/victim.
link_archive "$(archive_of "$dump")" "$A1" ../../out/victim
echo "in use" >"$FILES/$A2"
run_restore "$dump"
[ "$status" -ne 0 ] || fail "the archive was taken"
[ "$(database notes)" = original ] || fail "notes holds '$(database notes)'"
[ "$(ls -A "$FILES")" = "$A2" ] || fail "the folder holds: $(ls -A "$FILES" | tr '\n' ' ')"
[ "$(stat -c '%u:%g %h' "$work/out/victim")" = "$before" ] || fail "the file outside changed: $(stat -c '%u:%g %h' "$work/out/victim")"
[ "$(cat "$work/out/victim")" = victim ] || fail "the file outside was written to"
echo "ok: $case_name"

files_begin "files: a .replaced left by an earlier restore is moved aside, not removed"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
rm -rf "$work/source" && mkdir "$work/source"
echo restored >"$work/source/$A1"
make_archive "$(archive_of "$dump")"
mkdir "$FILES/.replaced"
echo "kept from before" >"$FILES/.replaced/$A3"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
kept=$(ls -d "$FILES"/.replaced-* 2>/dev/null | head -n 1)
[ -n "$kept" ] && [ "$(cat "$kept/$A3")" = "kept from before" ] || fail "the earlier .replaced is gone"
grep -q "was moved to" "$STATE/log" || fail "the log does not say where it went"
echo "ok: $case_name"

files_begin "files: the database does not load: the files are untouched"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
rm -rf "$work/source" && mkdir "$work/source"
echo restored >"$work/source/$A1"
make_archive "$(archive_of "$dump")"
echo "in use" >"$FILES/$A2"
touch "$STATE/restore-fails"
run_restore "$dump"
[ "$status" -ne 0 ] || fail "the restore reported success"
[ "$(ls -A "$FILES")" = "$A2" ] || fail "the folder holds: $(ls -A "$FILES" | tr '\n' ' ')"
echo "ok: $case_name"

files_begin "files: a dump from before there were archives restores the database and says the files stay"
dump=$(old_dump -3600)
echo original >"$STATE/dbs/notes"
echo "in use" >"$FILES/$A2"
run_restore "$dump"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(cat "$FILES/$A2")" = "in use" ] || fail "the files were touched"
grep -q "files of attachments are left as they are" "$STATE/log" || fail "no warning about the files"
echo "ok: $case_name"
unset ATTACHMENTS_DIR

# Encryption, copies, alerts and the healthcheck.
KEY=age1stand-in
A1=00000000-0000-4000-8000-000000000001

once() {
  status=0
  PATH="$work/bin:$PATH" sh "$here/backup.sh" once >"$STATE/log" 2>&1 || status=$?
}

# Everything in the backup folder that is not sealed: a plain dump or
# archive, or a partial file of either.
plain_files() {
  for found in "$BACKUP_DIR"/notes-* "$BACKUP_DIR"/.notes-*; do
    [ -e "$found" ] || continue
    [ "$(head -n 1 "$found")" = sealed ] || echo "$(basename "$found")"
  done
}

# The times there are dumps for, each counted once.
stem_count() {
  ls "$BACKUP_DIR" | grep -E '\.dump(\.age)?$' | sed -E 's/\.dump(\.age)?$//' | sort -u | wc -l | tr -d ' '
}

files_begin "encrypted: the dump and the archive are written through age, and nothing plain is left"
export BACKUP_ENCRYPT_TO="$KEY"
echo one >"$FILES/$A1"
once
[ "$status" -eq 0 ] || fail "once failed"
dump=$(ls "$BACKUP_DIR" | grep '\.dump\.age$')
[ -n "$dump" ] || fail "no .dump.age was written"
[ -f "$(archive_of "${dump%.age}").age" ] || fail "no .files.tar.age beside $dump"
[ -z "$(plain_files)" ] || fail "plain files in the backup folder: $(plain_files)"
grep -q -e "-r $KEY" "$STATE/calls" || fail "age was not given the key"
[ -s "$BACKUP_DIR/.last-good-dump" ] || fail "the time of the good dump was not written"
echo "ok: $case_name"

files_begin "encrypted: age fails half way: no file of the dump is left, and an alert goes out"
export BACKUP_ENCRYPT_TO="$KEY" BACKUP_ALERT_URL=http://alerts.invalid/notes
echo one >"$FILES/$A1"
touch "$STATE/age-fails"
once
[ "$status" -ne 0 ] || fail "once reported success"
[ -z "$(ls -A "$BACKUP_DIR" | grep -v '^\.last-good-dump$' || true)" ] || fail "left in the backup folder: $(ls -A "$BACKUP_DIR" | tr '\n' ' ')"
[ ! -e "$BACKUP_DIR/.last-good-dump" ] || fail "a failed dump was taken for a good one"
[ "$(count "$STATE/alerts")" -eq 1 ] && grep -q "failed" "$STATE/alerts" || fail "expected one alert, got: $(cat "$STATE/alerts")"
echo "ok: $case_name"

begin "encrypted: pg_dump fails: no partial file is left"
export BACKUP_ENCRYPT_TO="$KEY"
touch "$STATE/fail"
once
[ "$status" -ne 0 ] || fail "once reported success"
[ -z "$(ls -A "$BACKUP_DIR")" ] || fail "left in the backup folder: $(ls -A "$BACKUP_DIR" | tr '\n' ' ')"
echo "ok: $case_name"

begin "encrypted: a plain and an encrypted file of one time are one dump, and are pruned together"
export BACKUP_ENCRYPT_TO="$KEY"
oldest=$(old_dump $((-4 * DAY)))
echo sealed >"$BACKUP_DIR/$oldest.age"
echo sealed >"$BACKUP_DIR/${oldest%.dump}.files.tar.age"
middle=$(old_dump $((-3 * DAY)))
echo sealed >"$BACKUP_DIR/$middle.age"
echo sealed >"$BACKUP_DIR/$(old_dump $((-2 * DAY))).age"
once
[ "$status" -eq 0 ] || fail "once failed"
[ "$(stem_count)" -eq 3 ] || fail "expected the dumps of 3 times, found $(stem_count): $(ls "$BACKUP_DIR" | tr '\n' ' ')"
[ -z "$(ls "$BACKUP_DIR" | grep -F "${oldest%.dump}" || true)" ] || fail "a file of the oldest dump was kept: $(ls "$BACKUP_DIR" | tr '\n' ' ')"
[ -e "$BACKUP_DIR/$middle" ] && [ -e "$BACKUP_DIR/$middle.age" ] || fail "a dump with two files was pruned as if it were two dumps"
echo "ok: $case_name"

begin "encrypted: an encrypted dump an hour old counts, and one dated in the future is kept and named"
old_dump $((-2 * DAY)) >/dev/null
recent=$(old_dump -3600)
mv "$BACKUP_DIR/$recent" "$BACKUP_DIR/$recent.age"
ahead=$(old_dump $((2 * DAY)))
mv "$BACKUP_DIR/$ahead" "$BACKUP_DIR/$ahead.age"
run_loop
[ "$(count "$STATE/attempts")" -eq 0 ] || fail "a dump was made although an encrypted one is an hour old"
[ -e "$BACKUP_DIR/$ahead.age" ] || fail "the encrypted dump from the future was removed"
grep -q "warning: dated in the future.*$ahead.age" "$STATE/log" || fail "no warning names the encrypted dump from the future"
echo "ok: $case_name"

files_begin "copy: gets the new dump and its archive, and a failed copy is not a failed dump but alerts"
export BACKUP_COPY_COMMAND='echo "$@" >>"$STATE/copied"; [ ! -e "$STATE/copy-fails" ]'
export BACKUP_ALERT_URL=http://alerts.invalid/notes
touch "$STATE/real-sleep"
once
[ "$status" -eq 0 ] || fail "once failed"
dump=$(ls "$BACKUP_DIR" | grep '\.dump$')
[ "$(cat "$STATE/copied")" = "$BACKUP_DIR/$dump $(archive_of "$dump")" ] || fail "the copy was given: $(cat "$STATE/copied")"
[ "$(count "$STATE/alerts")" -eq 0 ] || fail "an alert for a copy that worked"
sleep 1
touch "$STATE/copy-fails"
once
[ "$status" -eq 0 ] || fail "a failed copy failed the dump"
[ "$(stem_count)" -eq 2 ] || fail "expected both dumps to be there, found $(stem_count)"
[ "$(count "$STATE/alerts")" -eq 1 ] && grep -q "copy of notes-.*failed" "$STATE/alerts" || fail "expected one alert about the copy, got: $(cat "$STATE/alerts")"
echo "ok: $case_name"

begin "copy: a copy that hangs is stopped after BACKUP_COPY_TIMEOUT_SECONDS, all of it"
# More than one process, the way a loop over the files with rclone in it is:
# a shell inside the shell of the command. Stopping only the outer one would
# leave the inner one to write "late" after the copy was given up.
export BACKUP_COPY_COMMAND='for file; do sh -c "\"$REAL_SLEEP\" 3; echo late >\"$STATE/late\""; done'
export BACKUP_COPY_TIMEOUT_SECONDS=1 BACKUP_ALERT_URL=http://alerts.invalid/notes
touch "$STATE/real-sleep"
started=$(date +%s)
once
[ "$status" -eq 0 ] || fail "a copy that timed out failed the dump"
[ $(($(date +%s) - started)) -lt 3 ] || fail "the copy was not stopped in time"
grep -q "took longer than 1s" "$STATE/log" || fail "the log does not say the copy was stopped"
grep -q "took longer than 1s" "$STATE/alerts" || fail "no alert says the copy was stopped"
"$REAL_SLEEP" 4
[ ! -e "$STATE/late" ] || fail "a part of the copy kept running after the timeout"
unset BACKUP_COPY_TIMEOUT_SECONDS
echo "ok: $case_name"

begin "copy: what a copy leaves running is ended when it is done"
export BACKUP_COPY_COMMAND='sh -c "\"$REAL_SLEEP\" 3; echo late >\"$STATE/late\"" & echo "$@" >"$STATE/copied"'
touch "$STATE/real-sleep"
once
[ "$status" -eq 0 ] || fail "once failed"
[ -s "$STATE/copied" ] || fail "the copy did not run"
grep -q "copied notes-" "$STATE/log" || fail "the copy is not logged as done"
"$REAL_SLEEP" 4
[ ! -e "$STATE/late" ] || fail "what the copy left behind kept running"
echo "ok: $case_name"

begin "alerts: a dump that keeps failing in the loop alerts once, not once a round"
export BACKUP_ALERT_URL=http://alerts.invalid/notes
touch "$STATE/fail" "$STATE/alert-fails"
run_loop
[ "$(count "$STATE/attempts")" -gt 1 ] || fail "expected the loop to try more than once"
[ "$(count "$STATE/alerts")" -eq 1 ] || fail "expected one alert, got $(count "$STATE/alerts")"
grep -q "could not send the alert" "$STATE/log" || fail "an alert that did not go out is not logged"
if grep -q "alerts.invalid" "$STATE/log"; then fail "the alert address is in the log"; fi
echo "ok: $case_name"

files_begin "restore: an encrypted dump and archive are decrypted as they are read"
export BACKUP_IDENTITY_FILE="$STATE/key.txt"
echo key >"$BACKUP_IDENTITY_FILE"
dump=$(old_dump -3600)
echo new >"$BACKUP_DIR/$dump"
{ echo sealed; cat "$BACKUP_DIR/$dump"; } >"$BACKUP_DIR/$dump.age"
rm "$BACKUP_DIR/$dump"
rm -rf "$work/source" && mkdir "$work/source"
echo restored >"$work/source/$A1"
make_archive "$work/plain.tar"
{ echo sealed; cat "$work/plain.tar"; } >"$(archive_of "$dump").age"
echo original >"$STATE/dbs/notes"
run_restore "$dump.age"
[ "$status" -eq 0 ] || fail "the restore failed"
[ "$(database notes)" = restored ] || fail "notes holds '$(database notes)'"
[ "$(cat "$STATE/loaded")" = new ] || fail "pg_restore was given: $(cat "$STATE/loaded")"
[ "$(cat "$FILES/$A1" 2>/dev/null)" = restored ] || fail "the archived file is not in place"
[ "$(ls -A "$FILES")" = "$A1" ] || fail "the files folder holds: $(ls -A "$FILES" | tr '\n' ' ')"
echo "ok: $case_name"

for key in missing wrong; do
  files_begin "restore: an encrypted dump with a $key key: nothing is touched"
  export BACKUP_IDENTITY_FILE="$STATE/key.txt"
  [ "$key" = missing ] || echo "another key" >"$BACKUP_IDENTITY_FILE"
  dump=$(old_dump -3600)
  { echo sealed; echo new; } >"$BACKUP_DIR/$dump.age"
  rm "$BACKUP_DIR/$dump"
  rm -rf "$work/source" && mkdir "$work/source"
  echo restored >"$work/source/$A1"
  make_archive "$work/plain.tar"
  { echo sealed; cat "$work/plain.tar"; } >"$(archive_of "$dump").age"
  echo original >"$STATE/dbs/notes"
  echo "in use" >"$FILES/$A2"
  run_restore "$dump.age"
  [ "$status" -ne 0 ] || fail "the restore reported success"
  [ "$(database notes)" = original ] || fail "notes holds '$(database notes)'"
  [ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
  [ "$(ls -A "$FILES")" = "$A2" ] || fail "the files folder holds: $(ls -A "$FILES" | tr '\n' ' ')"
  echo "ok: $case_name"
done

begin "restore: the dump does not decrypt: the database is untouched"
export BACKUP_IDENTITY_FILE="$STATE/key.txt"
echo key >"$BACKUP_IDENTITY_FILE"
dump=$(old_dump -3600)
echo "not sealed" >"$BACKUP_DIR/$dump.age"
rm "$BACKUP_DIR/$dump"
echo original >"$STATE/dbs/notes"
run_restore "$dump.age"
[ "$status" -ne 0 ] || fail "the restore reported success"
[ "$(database notes)" = original ] || fail "notes holds '$(database notes)'"
[ "$(ls "$STATE/dbs")" = notes ] || fail "databases left behind: $(ls "$STATE/dbs" | tr '\n' ' ')"
echo "ok: $case_name"
unset ATTACHMENTS_DIR

health() {
  status=0
  PATH="$work/bin:$PATH" sh "$here/backup.sh" health >"$STATE/log" 2>&1 || status=$?
}

begin "health: unhealthy without a good dump, healthy after one, unhealthy once it is a day and a bit old"
health
[ "$status" -ne 0 ] || fail "healthy without any dump"
once
health
[ "$status" -eq 0 ] || fail "unhealthy right after a good dump: $(cat "$STATE/log")"
written=$(ls "$BACKUP_DIR" | grep '\.dump$')
[ "$(cut -d ' ' -f 2 "$BACKUP_DIR/.last-good-dump")" = "$written" ] || fail "the marker does not name the dump: $(cat "$BACKUP_DIR/.last-good-dump")"
[ "$(cut -d ' ' -f 1 "$BACKUP_DIR/.last-good-dump")" = "$(date -u -d "$(echo "$written" | sed -E 's/^notes-(....)(..)(..)T(..)(..)(..)Z\.dump$/\1-\2-\3 \4:\5:\6/')" +%s)" ] ||
  fail "the marker does not hold the time in the name of the dump: $(cat "$BACKUP_DIR/.last-good-dump")"
echo "$((now - DAY - 3600)) $written" >"$BACKUP_DIR/.last-good-dump"
health
[ "$status" -eq 0 ] || fail "unhealthy an hour after the next dump was due"
echo "$((now - DAY - 3 * 3600)) $written" >"$BACKUP_DIR/.last-good-dump"
health
[ "$status" -ne 0 ] || fail "healthy three hours after the next dump was due"
echo "$((now + DAY)) $written" >"$BACKUP_DIR/.last-good-dump"
health
[ "$status" -eq 0 ] || fail "a time from the future made it unhealthy"
rm "$BACKUP_DIR/$written"
health
[ "$status" -ne 0 ] || fail "healthy although the dump it names is gone"
grep -q "no longer in" "$STATE/log" || fail "the check does not say the dump is gone"
echo "ok: $case_name"

begin "health: dumps from before the marker count when the loop starts"
hour_old=$(old_dump -3600)
mv "$BACKUP_DIR/$hour_old" "$BACKUP_DIR/$hour_old.age"
run_loop
[ "$(count "$STATE/attempts")" -eq 0 ] || fail "a dump was made although one is an hour old"
health
[ "$status" -eq 0 ] || fail "unhealthy with a dump an hour old: $(cat "$STATE/log")"
[ "$(cut -d ' ' -f 2 "$BACKUP_DIR/.last-good-dump")" = "$hour_old.age" ] || fail "the marker names: $(cat "$BACKUP_DIR/.last-good-dump")"
echo "ok: $case_name"

echo "OK: the loop, the pruning and the restore held in every case"
