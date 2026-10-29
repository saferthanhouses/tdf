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
warn() { printf 'warning: %s\n' "$*" >&2; }

# Private apps are served by a ts-<app> Tailscale sidecar. Its first login needs TS_AUTHKEY_<APP>:
# without one, tailscale up times out after 60s and the container restarts in a loop. Serving HTTPS
# also needs HTTPS certificates enabled for the tailnet. Warns rather than fails: an already logged-in
# sidecar keeps working without a key.
check_tailscale_sidecars() {
	local all active service app var state certs
	all=$(platform-compose --profile tailscale config --services | grep '^ts-' || true)
	active=$(platform-compose config --services | grep '^ts-' || true)
	if [[ -n $all && -z $active ]]; then
		warn "COMPOSE_PROFILES doesn't include tailscale, so private apps (${all//$'\n'/, }) won't be served."
		return
	fi
	for service in $active; do
		app=${service#ts-}
		var=TS_AUTHKEY_$(tr '[:lower:]-' '[:upper:]_' <<<"$app")
		state=$(platform-compose exec -T "$service" tailscale --socket=/tmp/tailscaled.sock status --json 2>/dev/null | jq -r '.BackendState // empty' 2>/dev/null || true)
		if [[ -z ${!var:-} && $state != Running ]]; then
			warn "$service: $var is empty and the sidecar isn't logged in, so it will restart in a loop."
			warn "  Create a (non-ephemeral) auth key in the Tailscale admin console, set ts_authkey_apps = { $app = \"tskey-auth-...\" }"
			warn "  in terraform.tfvars, then: tofu apply, ./bootstrap.sh --admin <host>, and deploy again."
		elif [[ $state == Running ]]; then
			certs=$(platform-compose exec -T "$service" tailscale --socket=/tmp/tailscaled.sock status --json 2>/dev/null | jq -r '.CertDomains // [] | length' 2>/dev/null || echo 0)
			if [[ $certs == 0 ]]; then
				warn "$service: the tailnet has no HTTPS certificates, so https://$app.<tailnet>.ts.net won't work."
				warn "  Enable them in the Tailscale admin console (DNS > HTTPS Certificates), then: sudo platform-compose restart $service"
			else
				echo "$service: logged in, HTTPS ready"
			fi
		else
			echo "$service: will log in with $var"
		fi
	done
}

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

log "Tailscale sidecars (private apps)"
check_tailscale_sidecars

log "Starting services"
platform-compose up -d --remove-orphans --wait
docker image prune -f >/dev/null

platform-compose ps --format 'table {{.Service}}\t{{.Status}}'
