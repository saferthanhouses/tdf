#!/usr/bin/env bash
# Checks that backups are recent and WAL archiving is working, then pings Healthchecks.io.
# Runs hourly from cron on the platform Droplet (see infra/platform/provision.sh), using pgbackrest and
# psql inside the db container. Exits non-zero when unhealthy.
#
# Fails when:
#   - pgbackrest reports a stanza problem (missing stanza, no valid backups, ...)
#   - the newest backup is older than MAX_BACKUP_AGE_HOURS (default 26: diffs run daily)
#   - the newest full backup is older than MAX_FULL_AGE_HOURS (default 192: fulls run weekly)
#   - the newest backup is marked as having errors
#   - WAL archiving is currently failing (the last failure is newer than the last success)
#
# Set Healthchecks.io's period to 1 hour with a grace of about 2 hours, so a check that stops
# running at all (cron broken, Droplet down) also alerts.
set -euo pipefail

ENV_FILE=${PLATFORM_ENV:-/opt/platform/.env}
# shellcheck source=../platform/platform.env.example
[[ -r $ENV_FILE ]] && source "$ENV_FILE"

MAX_BACKUP_AGE_HOURS=${MAX_BACKUP_AGE_HOURS:-26}
MAX_FULL_AGE_HOURS=${MAX_FULL_AGE_HOURS:-192}
STANZA=${STANZA:-main}
NOW=${NOW:-$(date +%s)}
# Overridable for tests (DB_EXEC= runs the commands directly). Empty arrays are expanded as
# ${a[@]+"${a[@]}"} so this also runs on bash 3.2.
read -r -a as_postgres <<<"${DB_EXEC-platform-compose exec -T -u postgres db}"
PGBACKREST=${PGBACKREST:-pgbackrest}
PSQL=${PSQL:-psql}
CURL=${CURL:-curl}

problems=()
notes=()
problem() { problems+=("$1"); }
hours_ago() { awk -v s="$1" -v now="$NOW" 'BEGIN { printf "%.1f", (now - s) / 3600 }'; }

# --- Backups ----------------------------------------------------------------------------------
if ! info=$(${as_postgres[@]+"${as_postgres[@]}"} "$PGBACKREST" --stanza="$STANZA" info --output=json 2>&1); then
	problem "pgbackrest info failed: $info"
elif ! jq -e 'type == "array" and length > 0' >/dev/null 2>&1 <<<"$info"; then
	problem "pgbackrest info returned unexpected output: ${info:0:200}"
else
	stanza=$(jq -c --arg s "$STANZA" '[.[] | select(.name == $s)][0] // empty' <<<"$info")
	if [[ -z $stanza ]]; then
		problem "stanza '$STANZA' not found in pgbackrest info"
	else
		code=$(jq -r '.status.code' <<<"$stanza")
		[[ $code == 0 ]] || problem "stanza status $code: $(jq -r '.status.message' <<<"$stanza")"

		latest=$(jq -c '.backup | max_by(.timestamp.stop) // empty' <<<"$stanza")
		latest_label=$(jq -r '.label // ""' <<<"${latest:-null}")
		latest_full=$(jq -c '[.backup[] | select(.type == "full")] | max_by(.timestamp.stop) // empty' <<<"$stanza")
		if [[ -z $latest ]]; then
			problem "no backups in the repository"
		else
			stop=$(jq -r '.timestamp.stop' <<<"$latest")
			age=$(hours_ago "$stop")
			notes+=("latest $(jq -r '.type' <<<"$latest") backup $(jq -r '.label' <<<"$latest") ${age}h ago")
			((NOW - stop <= MAX_BACKUP_AGE_HOURS * 3600)) ||
				problem "latest backup is ${age}h old (limit ${MAX_BACKUP_AGE_HOURS}h)"
			[[ $(jq -r '.error // false' <<<"$latest") == false ]] ||
				problem "latest backup $(jq -r '.label' <<<"$latest") has errors"
		fi
		if [[ -z $latest_full ]]; then
			problem "no full backup in the repository"
		else
			full_stop=$(jq -r '.timestamp.stop' <<<"$latest_full")
			full_age=$(hours_ago "$full_stop")
			# Skip when the latest backup is this full, already noted above.
			[[ $(jq -r '.label' <<<"$latest_full") == "$latest_label" ]] || notes+=("latest full ${full_age}h ago")
			((NOW - full_stop <= MAX_FULL_AGE_HOURS * 3600)) ||
				problem "latest full backup is ${full_age}h old (limit ${MAX_FULL_AGE_HOURS}h)"
		fi
	fi
fi

# --- WAL archiving ----------------------------------------------------------------------------
# An idle database may archive rarely, so an old last_archived_time alone isn't a failure.
archiver_sql="SELECT failed_count, coalesce(last_failed_wal, ''),
	coalesce(extract(epoch FROM last_failed_time)::bigint, 0),
	coalesce(extract(epoch FROM last_archived_time)::bigint, 0)
	FROM pg_stat_archiver"
if ! archiver=$(${as_postgres[@]+"${as_postgres[@]}"} "$PSQL" -qAt -F '|' -c "$archiver_sql" 2>&1); then
	problem "could not query pg_stat_archiver: $archiver"
else
	IFS='|' read -r failed_count failed_wal failed_at archived_at <<<"$archiver"
	if ((failed_at > 0 && failed_at >= archived_at)); then
		problem "WAL archiving is failing: $failed_wal failed $(hours_ago "$failed_at")h ago ($failed_count failures since stats reset)"
	elif ((archived_at > 0)); then
		notes+=("last WAL archived $(hours_ago "$archived_at")h ago")
	fi
fi

# --- Report -----------------------------------------------------------------------------------
joined=$(printf '%s; ' ${notes[@]+"${notes[@]}"})
joined=${joined%; }
if ((${#problems[@]})); then
	report=$(printf 'UNHEALTHY\n'; printf -- '- %s\n' "${problems[@]}"; [[ -n $joined ]] && printf '(%s)\n' "$joined")
	status=1
else
	report="OK: $joined"
	status=0
fi
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$report"

if [[ -n ${HC_BACKUP_URL:-} ]]; then
	url=$HC_BACKUP_URL
	((status)) && url=$url/fail
	"$CURL" -fsS -m 10 --retry 3 --data-raw "$report" "$url" >/dev/null || echo "warning: could not ping healthchecks" >&2
fi
exit $status
