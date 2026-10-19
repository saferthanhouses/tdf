#!/usr/bin/env bash
# Prints cloud-init user-data that runs restore-test.sh on a fresh Ubuntu Droplet and powers it off.
# Used by .github/workflows/restore-test.yml; settings come from the environment (workflow secrets).
#
#   restore-test-user-data.sh > user-data.yaml
#
# The Droplet gets restore-test.sh, the Postgres Dockerfile and sanitize/*.sql from this checkout, so
# the restore always uses the same sanitize rules as the repository.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
VARS=(SPACES_ENDPOINT SPACES_BUCKET SPACES_REPO_PATH SPACES_KEY SPACES_SECRET PGBACKREST_CIPHER_PASS
	DUMPS_ENDPOINT_URL DUMPS_BUCKET DUMPS_KEY DUMPS_SECRET DUMPS_PREFIX RUN_TAG NO_PII_DATABASES TARGET_TIME HC_RESTORE_URL)

for var in SPACES_ENDPOINT SPACES_BUCKET SPACES_REPO_PATH SPACES_KEY SPACES_SECRET PGBACKREST_CIPHER_PASS \
	DUMPS_ENDPOINT_URL DUMPS_BUCKET DUMPS_KEY DUMPS_SECRET; do
	[[ -n ${!var:-} ]] || { echo "error: $var is not set" >&2; exit 1; }
done

b64() { base64 <"$1" | tr -d '\n'; }
file_entry() { # path-on-droplet permissions source-file
	printf '  - path: %s\n    permissions: "%s"\n    encoding: b64\n    content: %s\n' "$1" "$2" "$(b64 "$3")"
}

env_file=$(mktemp)
trap 'rm -f "$env_file"' EXIT
for var in "${VARS[@]}"; do
	printf '%s=%q\n' "$var" "${!var:-}" >>"$env_file"
done

echo "#cloud-config"
echo "write_files:"
file_entry /etc/restore-test.env 0600 "$env_file"
file_entry /opt/restore-test/restore-test.sh 0755 "$HERE/restore-test.sh"
file_entry /opt/restore-test/Dockerfile 0644 "$HERE/Dockerfile"
for sql in "$HERE"/sanitize/*.sql; do
	file_entry "/opt/restore-test/sanitize/$(basename "$sql")" 0644 "$sql"
done
cat <<'EOF2'
runcmd:
  # Watchdog: power off after 55 minutes whatever happens; the workflow destroys the Droplet anyway.
  - [shutdown, -h, "+55"]
  - [bash, -c, "POWER_OFF=1 /opt/restore-test/restore-test.sh >/var/log/restore-test.log 2>&1; shutdown -h now"]
EOF2
