#!/bin/sh
# Database tests: the trade state machine, who may do what, and the rules that must hold even
# against a hand-made request. Each suite gets a fresh throwaway database with stand-ins for the
# Supabase pieces (auth.uid, roles, storage, realtime), then setup.sql applied TWICE — it must be
# safe to re-run — then the suite, whose output is compared line by line with its .expected file.
#
# Needs a Postgres 15+ you can create databases on, via the usual PGHOST/PGPORT/PGUSER variables.
set -u
DIR=$(cd "$(dirname "$0")" && pwd); ROOT="$DIR/../.."
fail=0
for t in messages trades hardening matching aliases notifications offeritems history scale; do
  DB="dtp_test_${t}_$$"
  createdb "$DB" || exit 2
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/stub.sql" >/dev/null 2>&1 &&
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/setup.sql" >/dev/null 2>&1 &&
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/setup.sql" >/dev/null 2>&1 || { echo "FAIL $t: setup.sql did not apply cleanly twice"; fail=1; dropdb "$DB"; continue; }
  out=$(psql -q -d "$DB" -f "$DIR/$t.test.sql" 2>/dev/null | sed 's/^ *//' | grep -E '^[A-Z][0-9]+[a-z]? ')
  if [ "$t" = hardening ]; then
    # Two owners' sessions accept two offers on one item at the same moment: exactly one may win.
    for n in 1 2; do
      psql -q -d "$DB" -c "begin; set local role authenticated; select set_config('req.uid','a0000000-0000-0000-0000-000000000001',true); select public.accept_offer('40000000-0000-0000-0000-00000000000$n'); select pg_sleep(1); commit;" >/dev/null 2>>"/tmp/$DB.err" &
    done; wait
    out="$out
$(psql -q -t -d "$DB" -c "select 'R1 agreed trades after a simultaneous double accept: ' || count(*) from public.offers where item_id = '30000000-0000-0000-0000-000000000001' and status = 'agreed'" | sed 's/^ *//' | grep -E '^R1')
R1b the other accept was told: $(grep -o 'ERROR: .*' "/tmp/$DB.err" | head -1)"
    rm -f "/tmp/$DB.err"
  fi
  if [ "$t" = offeritems ]; then
    # Two owners accept, at the same moment, two offers that both put in the same card: one may win.
    for w in a0000000-0000-0000-0000-000000000001:40000000-0000-0000-0000-00000000000a c0000000-0000-0000-0000-000000000003:40000000-0000-0000-0000-00000000000c; do
      psql -q -d "$DB" -c "begin; set local role authenticated; select set_config('req.uid','${w%%:*}',true); select public.accept_offer('${w#*:}'); select pg_sleep(1); commit;" >/dev/null 2>>"/tmp/$DB.err" &
    done; wait
    out="$out
$(psql -q -t -d "$DB" -c "select 'R2 agreed trades holding one card after a simultaneous double accept: ' || count(*) from public.offers where '10000000-0000-0000-0000-0000000000b5' = any (give_items) and status = 'agreed'" | sed 's/^ *//' | grep -E '^R2')
R3 the other owner was told: $(grep -o 'ERROR: .*' "/tmp/$DB.err" | head -1)"
    rm -f "/tmp/$DB.err"
  fi
  if [ "$out" = "$(cat "$DIR/$t.expected")" ]; then echo "ok   $t ($(echo "$out" | wc -l | tr -d ' ') checks)"; else echo "FAIL $t"; echo "$out" | diff -u "$DIR/$t.expected" - ; fail=1; fi
  dropdb "$DB"
done
exit $fail
