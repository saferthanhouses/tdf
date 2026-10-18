#!/usr/bin/env bash
# Creates (or updates) one app's database and roles in the platform Postgres. Safe to re-run.
#
#   create-app-db.sh <app>
#
#   <app>_owner     owns the database and runs migrations
#   <app>_app       the app's connection: read/write data, no DDL
#   <app>_readonly  reporting and ad-hoc queries
#
# Passwords come from <APP>_OWNER_PASSWORD, <APP>_APP_PASSWORD and <APP>_READONLY_PASSWORD in the
# platform env file. Grants on tables created later come from default privileges on objects the owner
# creates, so run migrations as <app>_owner.
set -euo pipefail

ENV_FILE=${PLATFORM_ENV:-/opt/platform/.env}
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

app=${1:?usage: create-app-db.sh <app>}
[[ $app =~ ^[a-z][a-z0-9_]*$ ]] || die "app name must be a lowercase identifier"
# shellcheck source=platform.env.example
source "$ENV_FILE"

APP=$(tr '[:lower:]' '[:upper:]' <<<"$app")
for kind in OWNER APP READONLY; do
	var=${APP}_${kind}_PASSWORD
	[[ -n ${!var:-} ]] || die "$var is not set in $ENV_FILE"
	# Interpolated into SQL below.
	[[ ${!var} =~ ^[A-Za-z0-9_.~+=-]{16,}$ ]] || die "$var must be 16+ characters of [A-Za-z0-9_.~+=-] (e.g. openssl rand -hex 32)"
done
owner_pw_var=${APP}_OWNER_PASSWORD app_pw_var=${APP}_APP_PASSWORD ro_pw_var=${APP}_READONLY_PASSWORD

psql_db() { platform-compose exec -T -u postgres db psql -v ON_ERROR_STOP=1 -q "$@"; }

# Passwords go through stdin, not argv, so they don't show up in the process list.
psql_db <<SQL
\\set owner_pw '${!owner_pw_var}'
\\set app_pw '${!app_pw_var}'
\\set ro_pw '${!ro_pw_var}'
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['${app}_owner', '${app}_app', '${app}_readonly']) r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \\gexec
ALTER ROLE ${app}_owner PASSWORD :'owner_pw';
ALTER ROLE ${app}_app PASSWORD :'app_pw';
ALTER ROLE ${app}_readonly PASSWORD :'ro_pw';
SELECT 'CREATE DATABASE ${app} OWNER ${app}_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${app}') \\gexec
SQL

psql_db -d "$app" <<SQL
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE ${app} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${app} TO ${app}_app, ${app}_readonly;
GRANT USAGE ON SCHEMA public TO ${app}_app, ${app}_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${app}_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${app}_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${app}_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE ${app}_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${app}_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${app}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${app}_owner IN SCHEMA public GRANT SELECT ON TABLES TO ${app}_readonly;
SQL
echo "database ${app}: roles ${app}_owner, ${app}_app, ${app}_readonly ready"
