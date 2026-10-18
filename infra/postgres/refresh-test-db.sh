#!/usr/bin/env bash
# Rebuilds the test database from the latest prod backup, then sanitizes it.
# Runs weekly from cron on the test Droplet (see provision.sh); doubles as a restore test.
#
#   refresh-test-db.sh                                # latest backup
#   refresh-test-db.sh --target "2026-10-15 12:00"    # point-in-time restore
#
# While unsanitized prod data and prod passwords are present, Postgres listens on localhost only.
# It reopens to the VPC after sanitize.sql has run and the role passwords are reset to the test values.
set -euo pipefail

ENV_FILE=${PG_OPS_ENV:-/etc/pg-ops.env}
HERE=$(cd "$(dirname "$0")" && pwd)
LOG=$(mktemp)
exec > >(tee -a "$LOG") 2>&1

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
# shellcheck source=pg-ops.env.example
source "$ENV_FILE"
[[ $DB_ROLE == test ]] || die "refusing to run: DB_ROLE is '$DB_ROLE', not 'test' (this would overwrite the database)"

target=
if [[ ${1:-} == --target ]]; then
	target=${2:?--target needs a timestamp}
fi

PG_CONF_DIR=/etc/postgresql/$PG_VERSION/main
PG_SERVICE=postgresql@$PG_VERSION-main
LOCK_CONF=$PG_CONF_DIR/conf.d/95-refresh-lock.conf
DUMP_DIR=/var/backups/$DB_NAME-sanitized

ping_hc() { # status: start | '' (success) | fail
	[[ -n ${HC_REFRESH_URL:-} ]] || return 0
	local url=$HC_REFRESH_URL${1:+/$1}
	curl -fsS -m 10 --retry 3 --data-binary @<(tail -c 10000 "$LOG") "$url" >/dev/null || true
}
on_exit() {
	local status=$?
	if ((status != 0)); then
		echo "refresh FAILED (exit $status)"
		ping_hc fail
	fi
	rm -f "$LOG"
}
trap on_exit EXIT

psql_db() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" "$@"; }

wait_for_promotion() {
	for _ in $(seq 1 360); do
		if [[ $(sudo -u postgres psql -qAt -c 'SELECT pg_is_in_recovery()' 2>/dev/null) == f ]]; then
			return 0
		fi
		sleep 5
	done
	die "Postgres was still in recovery after 30 minutes"
}

ping_hc start
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) refreshing $DB_NAME from prod backups${target:+ (target $target)}"

echo "-- stopping Postgres and locking it to localhost"
systemctl stop "$PG_SERVICE"
cat >"$LOCK_CONF" <<'EOF'
# Written by refresh-test-db.sh while unsanitized data is present; removed when it finishes.
listen_addresses = 'localhost'
EOF
# Never archive from a restored copy (also set by provision.sh).
echo "archive_mode = off" >"$PG_CONF_DIR/conf.d/90-test.conf"

echo "-- restoring"
restore_args=(--stanza=main --delta --archive-mode=off restore)
[[ -n $target ]] && restore_args=(--stanza=main --delta --archive-mode=off --type=time "--target=$target" --target-action=promote restore)
sudo -u postgres pgbackrest "${restore_args[@]}"

systemctl start "$PG_SERVICE"
wait_for_promotion
echo "-- restored; recovery finished"

echo "-- sanitizing"
psql_db -f "$HERE/sanitize.sql"

echo "-- resetting role passwords to the test values"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<EOF
\set owner_pw '$OWNER_PASSWORD'
\set app_pw '$APP_PASSWORD'
\set ro_pw '$READONLY_PASSWORD'
ALTER ROLE ${DB_NAME}_owner PASSWORD :'owner_pw';
ALTER ROLE ${DB_NAME}_app PASSWORD :'app_pw';
ALTER ROLE ${DB_NAME}_readonly PASSWORD :'ro_pw';
EOF

echo "-- writing sanitized dump for developers"
install -d -m 750 -o postgres -g postgres "$DUMP_DIR"
dump=$DUMP_DIR/$DB_NAME-sanitized-$(date +%Y%m%d).dump
sudo -u postgres pg_dump -Fc -d "$DB_NAME" -f "$dump"
# Keep the four most recent dumps.
find "$DUMP_DIR" -name "$DB_NAME-sanitized-*.dump" -printf '%T@ %p\n' | sort -rn | tail -n +5 | cut -d' ' -f2- | xargs -r rm -f
echo "   $dump"

echo "-- reopening to the VPC"
rm -f "$LOCK_CONF"
systemctl restart "$PG_SERVICE"

rows=$(psql_db -At -c 'SELECT count(*) FROM transaction')
echo "== $(date -u +%Y-%m-%dT%H:%M:%SZ) done: $rows transactions"
ping_hc ""
