#!/usr/bin/env bash
# Deploys the platform from the repo checkout on the Droplet: pull, build, migrate, restart.
#
#   sudo /opt/platform/repo/infra/platform/deploy.sh
#
# Every compose service named *-migrate (tools profile) runs before the apps restart, so a new app
# only needs its database in APP_DATABASES and a migrate service in compose.yaml.
set -euo pipefail

ENV_FILE=${PLATFORM_ENV:-/opt/platform/.env}
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=platform.env.example
source "$ENV_FILE"

log() { printf '\n==> %s\n' "$*"; }

if [[ ${SKIP_PULL:-0} != 1 ]]; then
	log "Pulling ${REPO_BRANCH:-main}"
	git -C "$HERE/../.." pull --ff-only origin "${REPO_BRANCH:-main}"
fi

log "Building images"
platform-compose --profile tools build --pull

log "Starting Postgres"
platform-compose up -d --wait db

log "App databases"
for app in ${APP_DATABASES:-}; do
	"$HERE/create-app-db.sh" "$app"
done

log "Migrations"
for service in $(platform-compose --profile tools config --services | grep -- '-migrate$' || true); do
	echo "-- $service"
	platform-compose --profile tools run --rm "$service"
done

log "Starting services"
platform-compose up -d --remove-orphans --wait
docker image prune -f >/dev/null

platform-compose ps --format 'table {{.Service}}\t{{.Status}}'
