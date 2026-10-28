#!/usr/bin/env bash
# Restore test: restores the latest platform backup (or a point in time) from Spaces, sanitizes every
# database, and uploads a pg_dump of each to the dumps bucket for development use.
#
# Runs weekly on a short-lived Droplet created by .github/workflows/restore-test.yml (which then
# destroys it); also runs locally for testing (infra/platform/test/e2e.sh). Needs Docker; installs it
# if missing.
#
# Settings come from the environment or RESTORE_ENV (default /etc/restore-test.env):
#   SPACES_ENDPOINT SPACES_BUCKET SPACES_REPO_PATH  pgBackRest repository
#   SPACES_KEY SPACES_SECRET                        a READ-ONLY key for the backup bucket
#   PGBACKREST_CIPHER_PASS
#   DUMPS_ENDPOINT_URL DUMPS_BUCKET DUMPS_KEY DUMPS_SECRET  where sanitized dumps go (a separate bucket)
#   DUMPS_PREFIX (default restore-test), RUN_TAG (default: time of day)
#   NO_PII_DATABASES   databases with no personal data, dumped without a sanitize script
#   TARGET_TIME        optional point-in-time target, e.g. "2026-10-15 12:00:00+00"
#   HC_RESTORE_URL     optional Healthchecks.io ping URL
#   POWER_OFF=1        power the machine off when finished (the workflow waits for this)
#   For S3 stand-ins in tests: PGBACKREST_EXTRA (extra [global] lines), DUMPS_EXTRA_ARGS (aws cli
#   options), DOCKER_NETWORK (network the restore and upload containers join).
#
#   RECOVERY_TIMEOUT   seconds to wait for WAL replay (default 1800)
#
# Every database must have sanitize/<db>.sql or be listed in NO_PII_DATABASES; otherwise the run fails
# before anything is uploaded. The restored Postgres accepts no TCP connections, and is disconnected from
# the network as soon as recovery finishes, before any data is read.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
RESTORE_ENV=${RESTORE_ENV:-/etc/restore-test.env}
# shellcheck source=/dev/null
[[ -r $RESTORE_ENV ]] && source "$RESTORE_ENV"

NAME=${RESTORE_NAME:-restore-test}
IMAGE=$NAME/postgres:18
DUMPS_PREFIX=${DUMPS_PREFIX:-restore-test}
RUN_TAG=${RUN_TAG:-$(date -u +%H%M%S)}
DEST=s3://$DUMPS_BUCKET/$DUMPS_PREFIX/$(date -u +%Y-%m-%d)-$RUN_TAG
WORK=$(mktemp -d)
LOG=$WORK/log
exec > >(tee -a "$LOG") 2>&1

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

for var in SPACES_ENDPOINT SPACES_BUCKET SPACES_REPO_PATH SPACES_KEY SPACES_SECRET PGBACKREST_CIPHER_PASS \
	DUMPS_ENDPOINT_URL DUMPS_BUCKET DUMPS_KEY DUMPS_SECRET; do
	[[ -n ${!var:-} ]] || die "$var is not set"
done

net_args=()
[[ -n ${DOCKER_NETWORK:-} ]] && net_args=(--network "$DOCKER_NETWORK")

ping_hc() { # '' (success) | start | fail
	[[ -n ${HC_RESTORE_URL:-} ]] || return 0
	curl -fsS -m 10 --retry 3 --data-binary @<(tail -c 10000 "$LOG") "$HC_RESTORE_URL${1:+/$1}" >/dev/null || true
}
cleanup() {
	local status=$?
	docker rm -f "$NAME-db" >/dev/null 2>&1 || true
	docker volume rm -f "$NAME-pgdata" >/dev/null 2>&1 || true
	if ((status == 0)); then
		ping_hc ""
	else
		echo "== $(stamp) restore test FAILED (exit $status)"
		ping_hc fail
	fi
	rm -rf "$WORK"
	if [[ ${POWER_OFF:-0} == 1 ]]; then
		shutdown -h now
	fi
}
trap cleanup EXIT

read -r -a aws_extra <<<"${DUMPS_EXTRA_ARGS:-}"
aws_s3() {
	docker run --rm ${net_args[@]+"${net_args[@]}"} -v "$WORK/dumps:/dumps:ro" \
		-e AWS_ACCESS_KEY_ID="$DUMPS_KEY" -e AWS_SECRET_ACCESS_KEY="$DUMPS_SECRET" -e AWS_DEFAULT_REGION=us-east-1 \
		amazon/aws-cli --endpoint-url "$DUMPS_ENDPOINT_URL" ${aws_extra[@]+"${aws_extra[@]}"} s3 "$@"
}
psql_db() { docker exec -u postgres "$NAME-db" psql -v ON_ERROR_STOP=1 -qAt "$@"; }

ping_hc start
echo "== $(stamp) restore test${TARGET_TIME:+ to $TARGET_TIME}"

if ! command -v docker >/dev/null; then
	echo "-- installing Docker"
	curl -fsSL https://get.docker.com | sh
fi

echo "-- building $IMAGE"
docker build -q -t "$IMAGE" "$HERE" >/dev/null

mkdir -p "$WORK/pgbackrest" "$WORK/dumps"
cat >"$WORK/pgbackrest/pgbackrest.conf" <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=$SPACES_ENDPOINT
repo1-s3-region=us-east-1
repo1-s3-bucket=$SPACES_BUCKET
repo1-s3-key=$SPACES_KEY
repo1-s3-key-secret=$SPACES_SECRET
repo1-path=$SPACES_REPO_PATH
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$PGBACKREST_CIPHER_PASS
${PGBACKREST_EXTRA:-}
log-level-console=info

[main]
pg1-path=/var/lib/postgresql/18/docker
EOF
chmod 755 "$WORK/pgbackrest"
chmod 644 "$WORK/pgbackrest/pgbackrest.conf"

echo "-- restoring"
docker volume rm -f "$NAME-pgdata" >/dev/null 2>&1 || true
docker volume create "$NAME-pgdata" >/dev/null
restore_args=(--stanza=main --archive-mode=off)
if [[ -n ${TARGET_TIME:-} ]]; then
	restore_args+=(--type=time "--target=$TARGET_TIME" --target-action=promote)
fi
docker run --rm ${net_args[@]+"${net_args[@]}"} -u postgres \
	-v "$NAME-pgdata:/var/lib/postgresql" -v "$WORK/pgbackrest:/etc/pgbackrest:ro" \
	"$IMAGE" sh -c 'mkdir -p -m 700 /var/lib/postgresql/18/docker && exec pgbackrest "$@" restore' sh "${restore_args[@]}"

# Recovery replays WAL fetched from the repository (restore_command runs pgbackrest archive-get), so the
# container needs the network and the pgBackRest config until it's done. Postgres listens on no TCP
# port, so nothing can connect to it; archiving is off, so it can't push WAL anywhere.
recovery_network=${DOCKER_NETWORK:-bridge}
docker run -d --name "$NAME-db" --network "$recovery_network" --shm-size 512m \
	-v "$NAME-pgdata:/var/lib/postgresql" -v "$WORK/pgbackrest:/etc/pgbackrest:ro" "$IMAGE" \
	postgres -c listen_addresses= -c archive_mode=off -c shared_preload_libraries=pg_stat_statements >/dev/null

deadline=$((SECONDS + ${RECOVERY_TIMEOUT:-1800}))
until [[ $(psql_db -c 'SELECT pg_is_in_recovery()' 2>/dev/null) == f ]]; do
	if ((SECONDS > deadline)); then
		docker logs --tail 30 "$NAME-db" 2>&1 | sed 's/^/   | /'
		die "Postgres still in recovery after ${RECOVERY_TIMEOUT:-1800}s"
	fi
	sleep 5
done
# From here on the restored copy needs nothing from outside, so cut it off before handling its data.
docker network disconnect "$recovery_network" "$NAME-db"
echo "-- restored; recovery finished; container disconnected from the network"

databases=$(psql_db -d postgres -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1")
missing=()
for db in $databases; do
	if [[ ! -f $HERE/sanitize/$db.sql && " ${NO_PII_DATABASES:-} " != *" $db "* ]]; then
		missing+=("$db")
	fi
done
((${#missing[@]} == 0)) ||
	die "no sanitize/<db>.sql for: ${missing[*]} (add one, or list the database in NO_PII_DATABASES if it holds no personal data)"

for db in $databases; do
	if [[ -f $HERE/sanitize/$db.sql ]]; then
		echo "-- sanitizing $db"
		docker exec -i -u postgres "$NAME-db" psql -v ON_ERROR_STOP=1 -q -d "$db" <"$HERE/sanitize/$db.sql" >/dev/null
	else
		echo "-- $db: no personal data (NO_PII_DATABASES)"
	fi
	docker exec -u postgres "$NAME-db" pg_dump -Fc -d "$db" >"$WORK/dumps/$db.dump"
	echo "   $db.dump $(du -h "$WORK/dumps/$db.dump" | cut -f1)"
done

echo "-- uploading to $DEST/"
aws_s3 cp /dumps/ "$DEST/" --recursive --only-show-errors
date -u +%Y-%m-%dT%H:%M:%SZ >"$WORK/dumps/_SUCCESS"
aws_s3 cp /dumps/_SUCCESS "$DEST/_SUCCESS" --only-show-errors

echo "== $(stamp) restore test passed: $(wc -w <<<"$databases" | tr -d ' ') database(s) restored, sanitized and uploaded"
