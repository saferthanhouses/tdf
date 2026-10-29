#!/usr/bin/env bash
# Tests restore-dev-db.sh against throwaway containers: a Postgres 16 "dev" server, dumps made by Postgres 18,
# and an S3 gateway (Versity, TLS) standing in for the dumps bucket. Doesn't touch your dev database or Spaces.
#   infra/postgres/test/test-restore-dev-db.sh
# pass/fail always succeed, so `cond && pass || fail` is safe here.
# shellcheck disable=SC2015
set -euo pipefail

SCRIPT=$(cd "$(dirname "$0")/.." && pwd)/restore-dev-db.sh
P=rdtest-$$
NET=$P-net
TMP=$(mktemp -d)
S3_USER=rdtests3user
S3_PASS=rdtests3password123

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

cleanup() {
	docker rm -f "$P-dev" "$P-src" "$P-s3" >/dev/null 2>&1 || true
	docker volume rm -f "$P-s3data" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	rm -rf "$TMP"
}
trap cleanup EXIT

wait_pg() { for _ in $(seq 1 40); do docker exec "$1" pg_isready -q -U postgres 2>/dev/null && return; sleep 0.5; done; return 1; }
dev_psql() { docker exec -i "$P-dev" psql -U postgres -d devdb -qAt "$@"; }
aws_s3() {
	docker run --rm --network "$NET" -v "$TMP:/work" -w /work -e AWS_ACCESS_KEY_ID=$S3_USER -e AWS_SECRET_ACCESS_KEY=$S3_PASS \
		-e AWS_DEFAULT_REGION=us-east-1 amazon/aws-cli --endpoint-url https://s3:9000 --no-verify-ssl s3 "$@" >/dev/null 2>&1
}

echo "== Setting up"
docker network create "$NET" >/dev/null
mkdir -p "$TMP/certs" "$TMP/cache"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=s3 -addext subjectAltName=DNS:s3 \
	-keyout "$TMP/certs/private.key" -out "$TMP/certs/public.crt" 2>/dev/null
chmod 644 "$TMP/certs/private.key"
docker run -d --name "$P-s3" --network "$NET" --network-alias s3 -v "$TMP/certs:/certs:ro" -v "$P-s3data:/data" \
	versity/versitygw:latest --access $S3_USER --secret $S3_PASS --port :9000 \
	--cert /certs/public.crt --key /certs/private.key posix /data >/dev/null
docker run -d --name "$P-dev" --network "$NET" --network-alias devdb -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=devdb postgres:16-alpine >/dev/null
docker run -d --name "$P-src" --network "$NET" -e POSTGRES_PASSWORD=srcpass postgres:18 >/dev/null
wait_pg "$P-dev" && wait_pg "$P-src"
sleep 2
for _ in $(seq 1 30); do aws_s3 ls && break; sleep 1; done
aws_s3 mb s3://dumps

# Production-like dumps made by pg_dump 18: one per run, each marked with its run name.
make_dump() { # run
	docker exec "$P-src" psql -U postgres -qc "DROP DATABASE IF EXISTS barnbooks" -c "CREATE DATABASE barnbooks"
	docker exec "$P-src" psql -U postgres -d barnbooks -qc \
		"CREATE TABLE marker (run text); INSERT INTO marker VALUES ('$1'); CREATE TABLE transaction (id int); INSERT INTO transaction SELECT generate_series(1, 5)"
	mkdir -p "$TMP/runs/$1"
	docker exec "$P-src" pg_dump -U postgres -Fc barnbooks >"$TMP/runs/$1/barnbooks.dump"
}
make_dump 2026-10-01-111 && date >"$TMP/runs/2026-10-01-111/_SUCCESS"
make_dump 2026-10-20-222 && date >"$TMP/runs/2026-10-20-222/_SUCCESS"
make_dump 2026-10-25-333 # newest, but incomplete: no _SUCCESS
aws_s3 cp /work/runs s3://dumps/restore-test --recursive

dev_psql -c "CREATE TABLE marker (run text); INSERT INTO marker VALUES ('dev-original')"
printf 'DB_HOST=devdb\nDB_PORT=5432\nDB_USER=postgres\nDB_PASSWORD=devpass\nDB_NAME=devdb\n' >"$TMP/env"

run_script() {
	env SPACES_ACCESS_KEY_ID=$S3_USER SPACES_SECRET_ACCESS_KEY=$S3_PASS DUMPS_BUCKET=dumps \
		DUMPS_ENDPOINT_URL=https://s3:9000 DUMPS_EXTRA_ARGS=--no-verify-ssl DOCKER_NETWORK="$NET" \
		XDG_CACHE_HOME="$TMP/cache" "$SCRIPT" --env-file "$TMP/env" "$@"
}
marker() { dev_psql -c "SELECT run FROM marker"; }

echo "== Declining the prompt changes nothing"
echo n | run_script >/dev/null 2>&1 && fail "exit 0 after declining" || true
[[ $(marker) == dev-original ]] && pass "dev data untouched after 'n'" || fail "dev data changed: $(marker)"

echo "== Latest successful run"
# Five older backups already present: after this run only the newest five should remain.
mkdir -p "$TMP/cache/tdf/dev-db-backups"
for d in 20260101 20260102 20260103 20260104 20260105; do : >"$TMP/cache/tdf/dev-db-backups/devdb-$d-000000.dump"; done
if out=$(run_script --yes 2>&1); then pass "restore succeeded (Postgres 18 dump into a 16 server)"; else fail "restore failed: ${out: -600}"; fi
[[ $(marker) == 2026-10-20-222 ]] && pass "picked the newest run with _SUCCESS, skipping the incomplete one" || fail "restored $(marker)"
[[ $(dev_psql -c "SELECT count(*) FROM transaction") == 5 ]] && pass "rows restored" || fail "transaction rows: $(dev_psql -c 'SELECT count(*) FROM transaction')"
backups=("$TMP/cache/tdf/dev-db-backups"/devdb-*.dump)
[[ ${#backups[@]} == 5 ]] && pass "backups pruned to the newest five" || fail "${#backups[@]} backups kept"
newest=${backups[${#backups[@]} - 1]}
docker run --rm -i postgres:18 pg_restore -f - <"$newest" 2>/dev/null | grep -q dev-original &&
	pass "backup holds the previous dev data" || fail "backup doesn't contain the previous dev data"

echo "== A specific run"
run_script --yes --run 2026-10-01-111 >/dev/null 2>&1 && [[ $(marker) == 2026-10-01-111 ]] &&
	pass "--run restores that run" || fail "--run restored $(marker)"

echo "== Mistakes"
out=$(run_script --yes --db nosuchdb 2>&1) && fail "missing database accepted" || {
	grep -q "databases in that run: barnbooks" <<<"$out" && pass "unknown --db lists the databases available" || fail "unexpected: $out"
}
out=$(env -u SPACES_ACCESS_KEY_ID "$SCRIPT" --env-file "$TMP/env" --yes 2>&1) && fail "ran without Spaces key" || {
	grep -q "export SPACES_ACCESS_KEY_ID" <<<"$out" && pass "missing Spaces key is explained" || fail "unexpected: $out"
}

echo
if ((failures)); then echo "$failures check(s) failed"; exit 1; fi
echo "All checks passed"
