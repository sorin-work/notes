#!/bin/sh
# Proves that the dumps backup.sh makes can be restored. Runs in the postgres
# image, against a database nothing else is writing to. CI points it at the
# end-to-end test database once the tests are done.
#
#   1. check-backup-loop.sh: the daily loop, the pruning and the order of
#      the steps in a restore, with stand-ins for the database tools.
#   2. Three real dumps with BACKUP_KEEP=2 leave the two newest, and leave
#      files that are not dumps alone.
#   3. The newest dump restores into a scratch database.
#   4. Every table has the same number of rows in both, and the application
#      tables are not all empty.
#   5. The same dump restores over that database once it holds something
#      else, and nothing of the swap is left on the server.
#   6. A damaged dump, and a database with a client connected to it, leave
#      the database as it was.
#   7. With a real age key: an encrypted dump leaves no plain file, restores
#      with the key to the same row counts, and is refused with another key.
#
# Step 7 needs age, so this runs in the image of the backup service
# (scripts/backup.Dockerfile), not the plain postgres one.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
scratch="${PGDATABASE}_restore_check"
work=$(mktemp -d)

cleanup() {
  rm -rf "$work"
  [ -z "${holder:-}" ] || kill "$holder" 2>/dev/null || true
  for name in "$scratch" "${scratch}_restoring" "${scratch}_replaced"; do
    dropdb --if-exists --force "$name" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

fail() {
  echo "FAILED: $*" >&2
  exit 1
}

# One "schema.table rows" line per table.
row_counts() {
  psql -AtXq -F ' ' -v ON_ERROR_STOP=1 -d "$1" <<'SQL'
select format('select %L, count(*) from %I.%I', schemaname || '.' || tablename, schemaname, tablename)
from pg_tables
where schemaname not in ('pg_catalog', 'information_schema')
order by schemaname, tablename
\gexec
SQL
}

echo "== loop, pruning and restore with stand-ins"
sh "$here/check-backup-loop.sh"

export BACKUP_DIR="$work/dumps" BACKUP_KEEP=2
mkdir "$BACKUP_DIR"
echo "not a dump" >"$BACKUP_DIR/keep-me.txt"

echo "== retention"
sh "$here/backup.sh" once
first=$(ls "$BACKUP_DIR" | grep '\.dump$')
# Dump names have a resolution of one second.
sleep 1
sh "$here/backup.sh" once
sleep 1
sh "$here/backup.sh" once

left=$(ls "$BACKUP_DIR" | grep '\.dump$' | sort)
[ "$(echo "$left" | wc -l)" -eq 2 ] || fail "expected 2 dumps to be kept, found: $left"
if echo "$left" | grep -qx "$first"; then
  fail "the oldest dump ($first) was kept"
fi
[ -f "$BACKUP_DIR/keep-me.txt" ] || fail "a file that is not a dump was removed"
[ -z "$(ls -A "$BACKUP_DIR" | grep '\.partial$' || true)" ] || fail "a partial dump was left behind"
newest=$(echo "$left" | tail -n 1)

echo "== restore $newest into $scratch"
PGDATABASE="$scratch" sh "$here/backup.sh" restore "$newest"

echo "== row counts"
row_counts "$PGDATABASE" >"$work/source.txt"
row_counts "$scratch" >"$work/restored.txt"
cat "$work/source.txt"
diff "$work/source.txt" "$work/restored.txt" || fail "row counts differ between $PGDATABASE (-) and the restored copy (+)"
# Prisma's own table always has rows. Only the application's tables say
# whether there was anything to lose.
total=$(awk '$1 !~ /\._prisma_migrations$/ { rows += $2 } END { print rows + 0 }' "$work/source.txt")
[ "$total" -gt 0 ] || fail "the application tables of $PGDATABASE are empty, so this proves nothing"

sql() {
  psql -AtXq -v ON_ERROR_STOP=1 -d "$1" -c "$2"
}

# Databases the swap would leave behind if it went wrong.
leftovers() {
  sql postgres "select datname from pg_database where datname in ('${scratch}_restoring', '${scratch}_replaced')"
}

echo "== restore over a database that holds something else"
sql "$scratch" "create table left_from_before (id int); insert into left_from_before values (1), (2), (3); delete from note_tags; delete from note_links"
PGDATABASE="$scratch" sh "$here/backup.sh" restore "$newest"
row_counts "$scratch" >"$work/replaced.txt"
diff "$work/source.txt" "$work/replaced.txt" || fail "after restoring over an existing database its tables differ from $PGDATABASE (-)"
[ -z "$(leftovers)" ] || fail "left on the server after the swap: $(leftovers)"

echo "== a damaged dump leaves the database alone"
sql "$scratch" "create table marker (id int); insert into marker values (7)"
head -c 2000 "$BACKUP_DIR/$newest" >"$work/damaged.dump"
if PGDATABASE="$scratch" sh "$here/backup.sh" restore "$work/damaged.dump" >"$work/damaged.log" 2>&1; then
  fail "a damaged dump was restored"
fi
grep -q "$scratch was left as it was" "$work/damaged.log" || fail "the message does not say the database is untouched: $(cat "$work/damaged.log")"
[ "$(sql "$scratch" "select id from marker")" = 7 ] || fail "the database was changed by a restore that failed"
[ -z "$(leftovers)" ] || fail "left on the server after a failed restore: $(leftovers)"

echo "== a database somebody is connected to is not replaced, and the message names them"
PGAPPNAME=someone-else psql -qX -d "$scratch" -c "select pg_sleep(20)" >/dev/null 2>&1 &
holder=$!
tries=0
until [ "$(sql postgres "select count(*) from pg_stat_activity where datname = '$scratch' and backend_type = 'client backend' and application_name = 'someone-else'")" = 1 ]; do
  tries=$((tries + 1))
  [ "$tries" -lt 50 ] || fail "the second client did not connect"
  sleep 0.1
done
if PGDATABASE="$scratch" sh "$here/backup.sh" restore "$newest" >"$work/busy.log" 2>&1; then
  fail "the database was replaced under a connected client"
fi
# Exactly that one client: not this check's own session, and not a worker of
# the server such as autovacuum, which may be in the database at that moment.
grep -q "Connected now: someone-else (1)\.$" "$work/busy.log" || fail "the message does not name the client, and only it: $(cat "$work/busy.log")"
[ "$(sql "$scratch" "select id from marker")" = 7 ] || fail "the database was changed although a client was connected"
kill "$holder" 2>/dev/null || true
wait "$holder" 2>/dev/null || true
holder=''
# Killing the client does not end its query on the server at once.
sql postgres "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'someone-else'" >/dev/null
[ -z "$(leftovers)" ] || fail "left on the server after a refused swap: $(leftovers)"

echo "== an encrypted dump"
command -v age >/dev/null || fail "there is no age here: run this in the image of the backup service"
age-keygen -o "$work/key.txt" 2>/dev/null
age-keygen -o "$work/other-key.txt" 2>/dev/null
sealed_dir="$work/sealed"
mkdir "$sealed_dir"
BACKUP_DIR="$sealed_dir" BACKUP_ENCRYPT_TO="$(age-keygen -y "$work/key.txt")" sh "$here/backup.sh" once
sealed=$(ls "$sealed_dir" | grep '\.dump\.age$')
[ "$(ls "$sealed_dir" | grep -c '^notes-')" -eq 1 ] || fail "expected only $sealed, found: $(ls "$sealed_dir" | tr '\n' ' ')"
[ -z "$(ls -A "$sealed_dir" | grep '\.partial' || true)" ] || fail "a partial file was left behind"
head -n 1 "$sealed_dir/$sealed" | grep -q '^age-encryption.org/' || fail "$sealed is not an age file"
if grep -q -a 'PGDMP' "$sealed_dir/$sealed"; then fail "$sealed holds a plain dump"; fi
if PGDATABASE="$scratch" BACKUP_DIR="$sealed_dir" BACKUP_IDENTITY_FILE="$work/other-key.txt" \
  sh "$here/backup.sh" restore "$sealed" >"$work/wrong-key.log" 2>&1; then
  fail "an encrypted dump was restored with another key"
fi
[ "$(sql "$scratch" "select id from marker")" = 7 ] || fail "a restore with the wrong key changed the database"
[ -z "$(leftovers)" ] || fail "left on the server after a restore with the wrong key: $(leftovers)"
PGDATABASE="$scratch" BACKUP_DIR="$sealed_dir" BACKUP_IDENTITY_FILE="$work/key.txt" sh "$here/backup.sh" restore "$sealed"
row_counts "$scratch" >"$work/decrypted.txt"
diff "$work/source.txt" "$work/decrypted.txt" || fail "the restored encrypted dump differs from $PGDATABASE (-)"

echo "OK: $(wc -l <"$work/source.txt") tables came back from $newest, $total rows in the application tables"
