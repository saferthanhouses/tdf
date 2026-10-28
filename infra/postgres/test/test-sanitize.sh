#!/usr/bin/env bash
# Runs sanitize/barnbooks.sql against a throwaway copy of the local dev database and checks the result.
#   infra/postgres/test/test-sanitize.sh [container] [source-db]
# Needs the dev Postgres container from infra/compose.yaml. The source database is only read.
set -euo pipefail

CONTAINER=${1:-postgres_db}
SOURCE_DB=${2:-mydatabase}
PGUSER_IN_CONTAINER=$(docker exec "$CONTAINER" printenv POSTGRES_USER)
TEST_DB=sanitize_test_$$
SANITIZE=${SANITIZE_SQL:-$(cd "$(dirname "$0")/.." && pwd)/sanitize/barnbooks.sql}
TMP=$(mktemp -d)

psql_c() { docker exec -i "$CONTAINER" psql -U "$PGUSER_IN_CONTAINER" -v ON_ERROR_STOP=1 -qAt "$@"; }
cleanup() {
	psql_c -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB" >/dev/null || true
	rm -rf "$TMP"
}
trap cleanup EXIT

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

echo "Copying $SOURCE_DB -> $TEST_DB"
psql_c -d postgres -c "CREATE DATABASE $TEST_DB"
docker exec "$CONTAINER" pg_dump -U "$PGUSER_IN_CONTAINER" --no-owner "$SOURCE_DB" | psql_c -d "$TEST_DB" >/dev/null

# Values that must not survive: vendor names and match texts, bank descriptions, notes, filenames,
# and account numbers.
psql_c -d "$TEST_DB" >"$TMP/secrets" <<'EOF'
SELECT name FROM vendor
UNION SELECT unnest(match_patterns) FROM vendor
UNION SELECT raw_description FROM transaction WHERE raw_description IS NOT NULL
UNION SELECT description FROM transaction WHERE description <> ''
UNION SELECT filename FROM import_batch WHERE filename IS NOT NULL
UNION SELECT (regexp_matches(name, '[0-9]{3,}', 'g'))[1] FROM account;
EOF
# Reference values that are kept on purpose; a note that just says 'Feed' would otherwise look leaked.
psql_c -d "$TEST_DB" >"$TMP/kept" <<'EOF2'
SELECT name FROM management_category UNION SELECT name FROM enterprise
UNION SELECT name FROM transaction_type UNION SELECT bank FROM account WHERE bank IS NOT NULL;
EOF2
summary_sql="SELECT count(*), sum(amount), count(vendor_id), count(DISTINCT vendor_id), count(*) FILTER (WHERE status = 'posted') FROM transaction"
before=$(psql_c -d "$TEST_DB" -c "$summary_sql")
echo "Checking $(wc -l <"$TMP/secrets" | tr -d ' ') distinct sensitive values"

echo "Running sanitize.sql"
psql_c -d "$TEST_DB" <"$SANITIZE" >/dev/null

docker exec "$CONTAINER" pg_dump -U "$PGUSER_IN_CONTAINER" --data-only "$TEST_DB" >"$TMP/dump.sql"
leaked=$(grep -F -x -v -e '' "$TMP/secrets" | while IFS= read -r secret; do
	grep -qiF -- "$secret" "$TMP/kept" && continue
	grep -qF -- "$secret" "$TMP/dump.sql" && printf '%s\n' "$secret"
done || true)
if [[ -z $leaked ]]; then pass "no original vendor names, bank text, notes, filenames or account numbers in a dump"
else fail "values survived sanitizing:"; printf '          %s\n' "$leaked" | head -20; fi

after=$(psql_c -d "$TEST_DB" -c "$summary_sql")
if [[ $before == "$after" ]]; then pass "row counts, amounts, vendor links and statuses unchanged ($after)"
else fail "summary changed: before $before, after $after"; fi

unmatched=$(psql_c -d "$TEST_DB" -c "
	SELECT count(*) FROM transaction t JOIN vendor v ON v.id = t.vendor_id
	WHERE t.raw_description IS NOT NULL
		AND NOT EXISTS (SELECT 1 FROM unnest(v.match_patterns) p WHERE t.raw_description ILIKE '%' || p || '%')")
if [[ $unmatched == 0 ]]; then pass "every bank description still contains its vendor's match text"
else fail "$unmatched transactions no longer match their vendor"; fi

psql_c -d "$TEST_DB" -c "ALTER TABLE vendor ADD COLUMN contact_email text"
if out=$(psql_c -d "$TEST_DB" <"$SANITIZE" 2>&1); then
	fail "sanitize.sql ran despite an unreviewed column"
elif grep -q 'vendor.contact_email' <<<"$out"; then
	pass "refuses to run when a column hasn't been reviewed"
else
	fail "unexpected error for unreviewed column: $out"
fi

echo
if ((failures)); then echo "$failures check(s) failed"; exit 1; fi
echo "All checks passed"
