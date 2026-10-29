#!/usr/bin/env bash
# Replaces the local dev database with the latest sanitized production dump.
#
#   npm run db:restore-from-prod                     # latest successful restore test, database "barnbooks"
#   npm run db:restore-from-prod -- --run 2026-10-29-40929140854 --db barnbooks --yes
#
# The weekly restore test (.github/workflows/restore-test.yml, also runnable by hand from the Actions tab)
# uploads a sanitized pg_dump of each production database to the dumps bucket. This downloads one, backs up
# your current dev database to ~/.cache/tdf/dev-db-backups/ (outside the repo), and restores the dump into
# the database in .env.dev. Postgres 18 client tools run in Docker, so the dev server's version doesn't matter.
#
# Needs Docker, and a Spaces key that can read the dumps bucket in the environment (the one exported for
# OpenTofu works): SPACES_ACCESS_KEY_ID / SPACES_SECRET_ACCESS_KEY.
# Defaults: DUMPS_BUCKET=tdf-pg-dumps, DUMPS_ENDPOINT_URL=https://sfo3.digitaloceanspaces.com
# (see `tofu output buckets`). For tests: DUMPS_EXTRA_ARGS (aws cli options), DOCKER_NETWORK.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
ENV_FILE=$ROOT/.env.dev
DB=barnbooks
RUN=
ASSUME_YES=0
KEEP_DUMP=0
PG_IMAGE=postgres:18
BACKUP_DIR=${XDG_CACHE_HOME:-$HOME/.cache}/tdf/dev-db-backups
DUMPS_BUCKET=${DUMPS_BUCKET:-tdf-pg-dumps}
DUMPS_ENDPOINT_URL=${DUMPS_ENDPOINT_URL:-https://sfo3.digitaloceanspaces.com}

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while (($#)); do
	case $1 in
	--run) RUN=${2:?--run needs a folder like 2026-10-29-40929140854}; shift 2 ;;
	--db) DB=${2:?--db needs a database name}; shift 2 ;;
	--env-file) ENV_FILE=${2:?--env-file needs a path}; shift 2 ;;
	--yes | -y) ASSUME_YES=1; shift ;;
	--keep-dump) KEEP_DUMP=1; shift ;;
	-h | --help) usage ;;
	*) printf 'unknown option: %s\n\n' "$1" >&2; usage 1 ;;
	esac
done

if ! { command -v docker >/dev/null && docker info >/dev/null 2>&1; }; then die "Docker isn't running"; fi
[[ -n ${SPACES_ACCESS_KEY_ID:-} && -n ${SPACES_SECRET_ACCESS_KEY:-} ]] ||
	die "export SPACES_ACCESS_KEY_ID and SPACES_SECRET_ACCESS_KEY (a Spaces key that can read $DUMPS_BUCKET)"
[[ -r $ENV_FILE ]] || die "missing $ENV_FILE (cp .env.dev.example .env.dev)"

# Read DB_* from the env file without executing it.
env_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }
DB_HOST=$(env_value DB_HOST); DB_PORT=$(env_value DB_PORT); DB_USER=$(env_value DB_USER)
DB_PASSWORD=$(env_value DB_PASSWORD); DB_NAME=$(env_value DB_NAME)
DB_HOST=${DB_HOST:-localhost}; DB_PORT=${DB_PORT:-5432}
[[ -n $DB_USER && -n $DB_NAME ]] || die "DB_USER and DB_NAME must be set in $ENV_FILE"

# Postgres client tools run in a container: reach a database on this machine through Docker's host alias
# (macOS/Windows) or the host network (Linux).
pg_net=()
pg_host=$DB_HOST
if [[ $DB_HOST == localhost || $DB_HOST == 127.0.0.1 ]]; then
	if [[ $(uname -s) == Linux ]]; then pg_net=(--network host); else pg_host=host.docker.internal; fi
fi
[[ -n ${DOCKER_NETWORK:-} ]] && pg_net=(--network "$DOCKER_NETWORK")

WORK=$(mktemp -d)
trap '((KEEP_DUMP)) || rm -rf "$WORK"' EXIT

read -r -a aws_extra <<<"${DUMPS_EXTRA_ARGS:-}"
s3() {
	docker run --rm ${pg_net[@]+"${pg_net[@]}"} -v "$WORK:/work" -w /work \
		-e AWS_ACCESS_KEY_ID="$SPACES_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$SPACES_SECRET_ACCESS_KEY" \
		-e AWS_DEFAULT_REGION=us-east-1 amazon/aws-cli --endpoint-url "$DUMPS_ENDPOINT_URL" \
		${aws_extra[@]+"${aws_extra[@]}"} s3 "$@"
}
pg() {
	docker run --rm -i ${pg_net[@]+"${pg_net[@]}"} -v "$WORK:/work" -e PGPASSWORD="$DB_PASSWORD" "$PG_IMAGE" "$@"
}
conn=(-h "$pg_host" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")

# --- Pick the dump ----------------------------------------------------------------------------
echo "==> Finding the sanitized dump in s3://$DUMPS_BUCKET/restore-test/"
listing=$(s3 ls --recursive "s3://$DUMPS_BUCKET/restore-test/") || die "couldn't list s3://$DUMPS_BUCKET (check the key and DUMPS_ENDPOINT_URL)"
if [[ -z $RUN ]]; then
	# Folders are <date>-<run id>; the newest with a _SUCCESS marker is the latest complete restore test.
	RUN=$(awk '{print $4}' <<<"$listing" | grep '/_SUCCESS$' | awk -F/ '{print $2}' | sort | tail -1)
	[[ -n $RUN ]] || die "no successful restore test found; run it from GitHub: Actions > Restore test > Run workflow"
fi
key=restore-test/$RUN/$DB.dump
grep -q " $key\$" <<<"$listing" || die "s3://$DUMPS_BUCKET/$key doesn't exist (databases in that run: $(awk '{print $4}' <<<"$listing" | grep "^restore-test/$RUN/.*\.dump$" | sed 's#.*/##; s#\.dump$##' | tr '\n' ' '))"
echo "    $key ($(awk -v k="$key" '$4 == k {print $3}' <<<"$listing") bytes)"

cat <<EOF

This replaces dev database "$DB_NAME" on $DB_HOST:$DB_PORT with production's sanitized "$DB" from $RUN.
Your current dev data is backed up to $BACKUP_DIR first.
EOF
if ((!ASSUME_YES)); then
	read -r -p "Continue? [y/N] " answer
	[[ $answer == y || $answer == Y ]] || { echo "Cancelled."; exit 1; }
fi

echo "==> Downloading"
s3 cp "s3://$DUMPS_BUCKET/$key" "/work/$DB.dump" --only-show-errors

echo "==> Backing up the current dev database"
mkdir -p "$BACKUP_DIR"
backup=$BACKUP_DIR/$DB_NAME-$(date +%Y%m%d-%H%M%S).dump
pg pg_dump "${conn[@]}" -Fc >"$backup" || die "backup failed; nothing was restored"
echo "    $backup ($(du -h "$backup" | cut -f1))"
# Keep the five most recent backups (timestamped names sort oldest first).
backups=("$BACKUP_DIR"/"$DB_NAME"-*.dump)
for ((i = 0; i < ${#backups[@]} - 5; i++)); do rm -f "${backups[i]}"; done

echo "==> Restoring"
# --no-owner/--no-acl: production's roles (barnbooks_owner, ...) don't exist locally.
set +e
out=$(pg pg_restore "${conn[@]}" --clean --if-exists --no-owner --no-acl "/work/$DB.dump" 2>&1)
status=$?
set -e
# Harmless when the dev server is older than the dump: settings it doesn't know yet.
errors=$(grep -E 'error:' <<<"$out" | grep -v -E 'unrecognized configuration parameter "(transaction_timeout|idle_session_timeout)"' || true)
if [[ -n $errors ]]; then
	printf '%s\n' "$errors" | head -20 >&2
	die "pg_restore reported errors (exit $status). Your previous data is in $backup:
  docker run --rm -i -e PGPASSWORD=... $PG_IMAGE pg_restore -h $pg_host -U $DB_USER -d $DB_NAME --clean --if-exists --no-owner < $backup"
fi

echo "==> Restored. Row counts:"
pg psql "${conn[@]}" -qAt -c "
	SELECT format('    %-22s %s', relname, n_live_tup) FROM pg_stat_user_tables ORDER BY relname" 2>/dev/null ||
	pg psql "${conn[@]}" -qAt -c "SELECT format('    transactions %s', count(*)) FROM transaction"
((KEEP_DUMP)) && echo "    dump kept at $WORK/$DB.dump"
echo "Done. Previous dev data: $backup"
