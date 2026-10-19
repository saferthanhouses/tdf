#!/usr/bin/env bash
# pass/fail always succeed, so `cond && pass || fail` is safe here.
# shellcheck disable=SC2015
# End-to-end test of the platform stack on this machine, with an S3 gateway (Versity) standing in for
# DO Spaces.
#   infra/platform/test/e2e.sh
#
# Runs as compose project "platform-e2e" with its own volumes; it doesn't touch the dev database.
# Covers: the Postgres image, WAL archiving and pgBackRest backups to S3, create-app-db.sh, migrations,
# the API and web containers, check-backup-freshness.sh, and restore-test.sh (refusing an unreviewed
# database, then restoring, sanitizing and uploading dumps). Not covered: Tailscale, Caddy's public
# certificates, the DigitalOcean Droplet lifecycle, real Spaces.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
PROJECT=platform-e2e
NETWORK=${PROJECT}_backend
WEB_PORT=${E2E_WEB_PORT:-18081}
TMP=$(mktemp -d)
S3_USER=e2es3admin
S3_PASS=e2es3password12345

failures=0
step() { printf '\n== %s\n' "$*"; }
# Runs a command silently, printing its output only if it fails.
quiet() {
	local out
	if ! out=$("$@" 2>&1); then
		printf '%s\n' "$out" >&2
		return 1
	fi
}
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# --- Scaffolding ------------------------------------------------------------------------------
mkdir -p "$TMP/bin" "$TMP/state/postgres" "$TMP/state/pgbackrest" "$TMP/s3-certs"
cat >"$TMP/.env" <<EOF
POSTGRES_SUPERUSER_PASSWORD=e2esuperuserpassword
APP_DATABASES="barnbooks"
BARNBOOKS_OWNER_PASSWORD=e2eownerpassword123
BARNBOOKS_APP_PASSWORD=e2eapppassword12345
BARNBOOKS_READONLY_PASSWORD=e2ereadonlypassword
FARM_SITE_DOMAIN=localhost
ACME_EMAIL=e2e@example.com
STATE_DIR=$TMP/state
PGDATA_DIR=pgdata
DB_MEM_LIMIT=512m
HC_BACKUP_URL=
EOF
printf 'shared_buffers = 128MB\n' >"$TMP/state/postgres/tuning.conf"
cat >"$TMP/state/pgbackrest/pgbackrest.conf" <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=s3
repo1-storage-port=9000
repo1-s3-uri-style=path
repo1-storage-verify-tls=n
repo1-s3-region=us-east-1
repo1-s3-bucket=backups
repo1-s3-key=$S3_USER
repo1-s3-key-secret=$S3_PASS
repo1-path=/platform
repo1-retention-full=4
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=e2e-cipher-pass
compress-type=zst
start-fast=y

[main]
pg1-path=/var/lib/postgresql/18/docker
EOF
chmod 644 "$TMP/state/pgbackrest/pgbackrest.conf"

# pgBackRest only talks to S3 over TLS, so the gateway gets a throwaway self-signed certificate.
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=s3 -addext subjectAltName=DNS:s3 \
	-keyout "$TMP/s3-certs/private.key" -out "$TMP/s3-certs/public.crt" 2>/dev/null
chmod 644 "$TMP/s3-certs/private.key"

cat >"$TMP/override.yaml" <<EOF
services:
  s3:
    image: versity/versitygw:latest
    command: ["--access", "$S3_USER", "--secret", "$S3_PASS", "--port", ":9000",
              "--cert", "/certs/public.crt", "--key", "/certs/private.key", "posix", "/data"]
    volumes:
      - $TMP/s3-certs:/certs:ro
      - s3-data:/data
    networks: [backend]
  barnbooks-web:
    ports: ["127.0.0.1:$WEB_PORT:80"]
volumes:
  s3-data: {}
EOF
cat >"$TMP/bin/platform-compose" <<EOF
#!/bin/sh
exec docker compose -p $PROJECT --project-directory "$ROOT/infra/platform" -f "$ROOT/infra/platform/compose.yaml" -f "$TMP/override.yaml" --env-file "$TMP/.env" "\$@"
EOF
chmod +x "$TMP/bin/platform-compose"
export PATH="$TMP/bin:$PATH" PLATFORM_ENV=$TMP/.env

cleanup() {
	platform-compose --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
	docker rm -f platform-e2e-restore-db >/dev/null 2>&1 || true
	docker volume rm -f platform-e2e-restore-pgdata >/dev/null 2>&1 || true
	rm -rf "$TMP"
}
trap cleanup EXIT

aws_s3() {
	docker run --rm --network "$NETWORK" -e AWS_ACCESS_KEY_ID=$S3_USER -e AWS_SECRET_ACCESS_KEY=$S3_PASS \
		-e AWS_DEFAULT_REGION=us-east-1 -v "$TMP:/work" amazon/aws-cli --endpoint-url https://s3:9000 --no-verify-ssl "$@" 2>/dev/null
}
pgbackrest() { platform-compose exec -T -u postgres db pgbackrest --stanza=main "$@"; }
psql_super() { platform-compose exec -T -u postgres db psql -v ON_ERROR_STOP=1 -qAt "$@"; }

# --- Stack ------------------------------------------------------------------------------------
step "Building images"
platform-compose build -q db barnbooks-api barnbooks-web

step "S3 gateway (Spaces stand-in)"
quiet platform-compose up -d s3
for _ in $(seq 1 30); do aws_s3 s3 ls >/dev/null && break; sleep 1; done
quiet aws_s3 s3 mb s3://backups && quiet aws_s3 s3 mb s3://dumps && pass "buckets created"

step "Postgres, app database, backups"
quiet platform-compose up -d --wait db && pass "db healthy"
quiet "$ROOT/infra/platform/create-app-db.sh" barnbooks && pass "create-app-db.sh barnbooks"
quiet pgbackrest stanza-create && quiet pgbackrest check && pass "stanza created; WAL archiving to S3 works"
quiet pgbackrest --type=full backup && pass "full backup"

step "barnbooks app"
quiet platform-compose --profile tools run --rm barnbooks-migrate && pass "migrations as barnbooks_owner"
quiet platform-compose up -d --wait barnbooks-api barnbooks-web
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT/")
[[ $code == 200 ]] && pass "web app served" || fail "web app returned $code"
lookups=$(curl -s "http://127.0.0.1:$WEB_PORT/api/lookups")
cash_id=$(jq -r '.accounts[] | select(.name == "Cash") | .id' <<<"$lookups" 2>/dev/null || true)
[[ -n $cash_id ]] && pass "API reachable through the web proxy" || fail "API lookups failed: ${lookups:0:200}"

# Personal data that sanitizing must remove.
curl -sf -X POST "http://127.0.0.1:$WEB_PORT/api/vendors" -H 'content-type: application/json' \
	-d '{"name":"Dave Testperson","match_patterns":["DAVE TESTPERSON"]}' >/dev/null
curl -sf -X POST "http://127.0.0.1:$WEB_PORT/api/transactions" -H 'content-type: application/json' \
	-d "{\"date\":\"2026-10-18\",\"account_id\":$cash_id,\"amount\":-42.5,\"description\":\"Paid Dave Testperson cash\"}" >/dev/null &&
	pass "wrote a vendor and transaction through the API"

# A second database with no sanitize script.
psql_super -c "CREATE DATABASE scratch" && psql_super -d scratch -c "CREATE TABLE t (i int); INSERT INTO t VALUES (1)"
quiet pgbackrest --type=diff backup && quiet pgbackrest check && pass "diff backup; latest WAL archived"

step "check-backup-freshness.sh"
if out=$("$ROOT/infra/postgres/check-backup-freshness.sh" 2>&1) && [[ $out == *"OK: latest diff backup"* ]]; then
	pass "reports OK against the real repository"
else
	fail "freshness check: $out"
fi

# --- Restore test -----------------------------------------------------------------------------
restore_env() {
	env RESTORE_ENV=/dev/null RESTORE_NAME=platform-e2e-restore RUN_TAG=e2e DOCKER_NETWORK="$NETWORK" RECOVERY_TIMEOUT=180 \
		SPACES_ENDPOINT=s3 SPACES_BUCKET=backups SPACES_REPO_PATH=/platform \
		SPACES_KEY=$S3_USER SPACES_SECRET=$S3_PASS PGBACKREST_CIPHER_PASS=e2e-cipher-pass \
		PGBACKREST_EXTRA=$'repo1-storage-port=9000\nrepo1-s3-uri-style=path\nrepo1-storage-verify-tls=n' \
		DUMPS_ENDPOINT_URL=https://s3:9000 DUMPS_EXTRA_ARGS=--no-verify-ssl DUMPS_BUCKET=dumps \
		DUMPS_KEY=$S3_USER DUMPS_SECRET=$S3_PASS "$@"
}

step "restore-test.sh refuses a database with no sanitize script"
if out=$(restore_env "$ROOT/infra/postgres/restore-test.sh" 2>&1); then
	fail "restore test passed despite unreviewed database 'scratch'"
elif [[ $out == *"no sanitize/<db>.sql for: scratch"* ]]; then
	pass "failed naming 'scratch'"
else
	fail "unexpected failure: ${out: -400}"
fi
[[ -z $(aws_s3 s3 ls --recursive s3://dumps/) ]] && pass "nothing uploaded" || fail "dumps were uploaded by a failed run"

step "restore-test.sh with scratch marked as having no personal data"
if out=$(restore_env NO_PII_DATABASES=scratch "$ROOT/infra/postgres/restore-test.sh" 2>&1); then
	pass "restore, sanitize and upload succeeded"
else
	fail "restore test failed: ${out: -600}"
fi
listing=$(aws_s3 s3 ls --recursive s3://dumps/restore-test/ || true)
for f in barnbooks.dump scratch.dump _SUCCESS; do
	grep -q -- "-e2e/$f\$" <<<"$listing" && pass "uploaded $f" || fail "missing $f in dumps bucket"
done

key=$(awk '/-e2e\/barnbooks.dump$/ { print $4 }' <<<"$listing")
if [[ -n $key ]] && quiet aws_s3 s3 cp "s3://dumps/$key" /work/barnbooks.dump; then
	sql=$(docker run --rm -v "$TMP:/work:ro" platform/postgres:18 pg_restore -f - /work/barnbooks.dump)
	if grep -q 'Testperson' <<<"$sql"; then fail "sanitized dump still contains 'Testperson'"
	else pass "sanitized dump has no trace of the personal data"; fi
	grep -q $'\t-42.50\t' <<<"$sql" && pass "amounts kept in the dump" || fail "amount -42.50 missing from the dump"
else
	fail "could not download barnbooks.dump"
fi

echo
if ((failures)); then echo "$failures check(s) failed"; exit 1; fi
echo "All checks passed"
