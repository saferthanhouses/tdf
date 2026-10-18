#!/usr/bin/env bash
# Exercises check-backup-freshness.sh with stand-in pgbackrest, psql and curl commands.
#   infra/postgres/test/test-backup-freshness.sh
set -euo pipefail

CHECK=$(cd "$(dirname "$0")/.." && pwd)/check-backup-freshness.sh
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

NOW=1792000000
H=3600

# Stand-ins read their output from files the test case writes.
cat >"$TMP/pgbackrest" <<EOF
#!/usr/bin/env bash
[[ -f "$TMP/pgbackrest.fail" ]] && { echo "ERROR: [039]: unable to connect to repo" >&2; exit 39; }
cat "$TMP/info.json"
EOF
cat >"$TMP/psql" <<EOF
#!/usr/bin/env bash
cat "$TMP/archiver"
EOF
cat >"$TMP/curl" <<EOF
#!/usr/bin/env bash
for arg; do last=\$arg; done
echo "\$last" >>"$TMP/pings"
EOF
chmod +x "$TMP/pgbackrest" "$TMP/psql" "$TMP/curl"
printf 'HC_BACKUP_URL=https://hc.example/ping/abc\n' >"$TMP/env"

backup() { # type label hours-ago [error]
	printf '{"type":"%s","label":"%s","timestamp":{"start":%d,"stop":%d},"error":%s}' \
		"$1" "$2" $((NOW - $3 * H - 600)) $((NOW - $3 * H)) "${4:-false}"
}
info() { # status-code message backups...
	local code=$1 message=$2
	shift 2
	local IFS=,
	printf '[{"name":"main","status":{"code":%d,"message":"%s"},"backup":[%s]}]' "$code" "$message" "$*" >"$TMP/info.json"
}
archiver() { # failed_count failed_wal failed_hours_ago archived_hours_ago (-1 = never)
	local failed_at=0 archived_at=0
	(($3 >= 0)) && failed_at=$((NOW - $3 * H))
	(($4 >= 0)) && archived_at=$((NOW - $4 * H))
	printf '%s|%s|%s|%s\n' "$1" "$2" "$failed_at" "$archived_at" >"$TMP/archiver"
}

failures=0
run_case() { # name expected-exit expected-ping-suffix expected-text
	local name=$1 want_exit=$2 want_ping=$3 want_text=$4 out code
	: >"$TMP/pings"
	set +e
	out=$(PG_OPS_ENV=$TMP/env NOW=$NOW PGBACKREST=$TMP/pgbackrest PSQL=$TMP/psql CURL=$TMP/curl "$CHECK" 2>&1)
	code=$?
	set -e
	local ping
	ping=$(cat "$TMP/pings")
	if [[ $code == "$want_exit" && $ping == "https://hc.example/ping/abc$want_ping" && $out == *"$want_text"* ]]; then
		printf '  ok    %s\n' "$name"
	else
		printf '  FAIL  %s\n        exit %s (want %s), ping "%s" (want suffix "%s")\n        output: %s\n' \
			"$name" "$code" "$want_exit" "$ping" "$want_ping" "$out"
		failures=$((failures + 1))
	fi
	rm -f "$TMP/pgbackrest.fail"
}

healthy_archiver() { archiver 0 '' -1 0; }

info 0 ok "$(backup full 20261011-020000F 50)" "$(backup diff 20261011-020000F_20261016-020000D 2)"
healthy_archiver
run_case "recent diff and full, archiving fine" 0 "" "OK: latest diff backup"

info 0 ok "$(backup full F 80)" "$(backup diff D 30)"
healthy_archiver
run_case "stale latest backup" 1 "/fail" "latest backup is 30.0h old"

info 0 ok "$(backup full F 200)" "$(backup diff D 2)"
healthy_archiver
run_case "stale full backup" 1 "/fail" "latest full backup is 200.0h old"

info 0 ok "$(backup full F 50)" "$(backup diff D 2 true)"
healthy_archiver
run_case "latest backup has errors" 1 "/fail" "has errors"

info 0 ok "$(backup full F 50)" "$(backup diff D 2)"
archiver 12 000000010000000A00000042 1 3
run_case "archiving failing" 1 "/fail" "WAL archiving is failing: 000000010000000A00000042"

info 0 ok "$(backup full F 50)" "$(backup diff D 2)"
archiver 3 000000010000000A00000001 5 0
run_case "old archive failure since recovered" 0 "" "OK:"

info 2 "no valid backups"
healthy_archiver
run_case "stanza has no backups" 1 "/fail" "stanza status 2: no valid backups"

touch "$TMP/pgbackrest.fail"
healthy_archiver
run_case "repository unreachable" 1 "/fail" "pgbackrest info failed: ERROR: [039]"

: >"$TMP/env"
info 0 ok "$(backup full F 80)" "$(backup diff D 30)"
healthy_archiver
: >"$TMP/pings"
set +e
PG_OPS_ENV=$TMP/env NOW=$NOW PGBACKREST=$TMP/pgbackrest PSQL=$TMP/psql CURL=$TMP/curl "$CHECK" >/dev/null 2>&1
code=$?
set -e
if [[ $code == 1 && ! -s $TMP/pings ]]; then printf '  ok    %s\n' "no HC_BACKUP_URL: still exits 1, no ping"
else printf '  FAIL  no HC_BACKUP_URL (exit %s, pings: %s)\n' "$code" "$(cat "$TMP/pings")"; failures=$((failures + 1)); fi

echo
if ((failures)); then echo "$failures case(s) failed"; exit 1; fi
echo "All cases passed"
