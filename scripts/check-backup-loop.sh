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

# Writes the file pg_dump was asked for, unless the case wants it to fail.
# With "fast-clock" the file gets a modification time in the future, as if
# the folder were on a machine whose clock runs ahead. With "slow" it takes
# as many seconds as that file says.
cat >"$work/bin/pg_dump" <<'STUB'
#!/bin/sh
echo attempt >>"$STATE/attempts"
[ ! -e "$STATE/fail" ] || exit 1
[ ! -e "$STATE/slow" ] || "$REAL_SLEEP" "$(cat "$STATE/slow")"
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
for arg in "$@"; do
  case $arg in
    --dbname=*) echo restored >"$STATE/dbs/${arg#--dbname=}" ;;
  esac
done
STUB
chmod +x "$work/bin/createdb" "$work/bin/dropdb" "$work/bin/pg_restore"

# Returns at once and stops the loop, its parent, after $ROUNDS naps.
cat >"$work/bin/sleep" <<'STUB'
#!/bin/sh
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
  export STATE BACKUP_DIR ROUNDS AHEAD REAL_SLEEP
  export BACKUP_KEEP=3 BACKUP_INTERVAL_SECONDS=$DAY PGDATABASE=notes
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

echo "OK: the loop, the pruning and the restore held in every case"
