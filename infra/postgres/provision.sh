#!/usr/bin/env bash
# Provisions a Postgres Droplet (Ubuntu 24.04 LTS) as the prod database or the test database.
#
#   scp -r infra/postgres root@<droplet>:/root/pg-ops
#   ssh root@<droplet> 'cp /root/pg-ops/pg-ops.env.example /etc/pg-ops.env && chmod 600 /etc/pg-ops.env'
#   # edit /etc/pg-ops.env, then:
#   ssh root@<droplet> /root/pg-ops/provision.sh
#
# Safe to re-run: config files are rewritten, roles and the database are created only if missing,
# and an existing filesystem on the data volume is never reformatted.
#
# Not covered here (set up in the DO control panel or with doctl):
#   - Cloud Firewall: 5432 only from the app Droplets' tag, 22 only from your IP
#   - Block Storage Volume attached to this Droplet (DATA_DEVICE)
#   - Spaces bucket in another region, with versioning on, and a read-only key for test
set -euo pipefail

ENV_FILE=${PG_OPS_ENV:-/etc/pg-ops.env}
HERE=$(cd "$(dirname "$0")" && pwd)
INSTALL_DIR=/opt/pg-ops

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -r $ENV_FILE ]] || die "missing $ENV_FILE (copy pg-ops.env.example and fill it in)"
# shellcheck source=pg-ops.env.example
source "$ENV_FILE"

for var in DB_ROLE PG_VERSION DB_NAME VPC_CIDR ADMIN_USER SPACES_ENDPOINT SPACES_BUCKET SPACES_REPO_PATH \
	SPACES_KEY SPACES_SECRET PGBACKREST_CIPHER_PASS OWNER_PASSWORD APP_PASSWORD READONLY_PASSWORD; do
	[[ -n ${!var:-} ]] || die "$var is not set in $ENV_FILE"
done
[[ $DB_ROLE == prod || $DB_ROLE == test ]] || die "DB_ROLE must be prod or test"
# DB_NAME is used in role names and SQL identifiers; passwords are interpolated into SQL.
[[ $DB_NAME =~ ^[a-z_][a-z0-9_]*$ ]] || die "DB_NAME must be a lowercase identifier"
for var in OWNER_PASSWORD APP_PASSWORD READONLY_PASSWORD; do
	[[ ${!var} =~ ^[A-Za-z0-9_.~+=-]{16,}$ ]] || die "$var must be 16+ characters of [A-Za-z0-9_.~+=-] (e.g. openssl rand -hex 32)"
done

PG_CONF_DIR=/etc/postgresql/$PG_VERSION/main
PG_DATA=/var/lib/postgresql/$PG_VERSION/main
PG_SERVICE=postgresql@$PG_VERSION-main
OWNER_ROLE=${DB_NAME}_owner
APP_ROLE=${DB_NAME}_app
READONLY_ROLE=${DB_NAME}_readonly

# ---------------------------------------------------------------------------------------------
log "Admin user and SSH hardening"
if ! id "$ADMIN_USER" &>/dev/null; then
	adduser --disabled-password --gecos '' "$ADMIN_USER"
	usermod -aG sudo "$ADMIN_USER"
	echo "$ADMIN_USER ALL=(ALL) NOPASSWD:ALL" >"/etc/sudoers.d/90-$ADMIN_USER"
	chmod 440 "/etc/sudoers.d/90-$ADMIN_USER"
fi
admin_home=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
if [[ ! -s $admin_home/.ssh/authorized_keys ]]; then
	[[ -s /root/.ssh/authorized_keys ]] || die "no SSH keys for root to copy to $ADMIN_USER; refusing to disable root login"
	install -d -m 700 -o "$ADMIN_USER" -g "$ADMIN_USER" "$admin_home/.ssh"
	install -m 600 -o "$ADMIN_USER" -g "$ADMIN_USER" /root/.ssh/authorized_keys "$admin_home/.ssh/authorized_keys"
fi
cat >/etc/ssh/sshd_config.d/90-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t
systemctl reload ssh || systemctl restart ssh
echo "Root SSH login is now disabled. Check 'ssh $ADMIN_USER@<droplet>' works before closing this session."

# ---------------------------------------------------------------------------------------------
log "Base packages, unattended upgrades, fail2ban"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg jq postgresql-common unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

# ---------------------------------------------------------------------------------------------
# Mount the volume before Postgres is installed, so the cluster is created on it.
if [[ -n ${DATA_DEVICE:-} ]]; then
	log "Data volume $DATA_DEVICE -> /var/lib/postgresql"
	[[ -b $DATA_DEVICE ]] || die "$DATA_DEVICE is not a block device (is the volume attached?)"
	if ! blkid "$DATA_DEVICE" &>/dev/null; then
		mkfs.ext4 -q "$DATA_DEVICE"
	fi
	uuid=$(blkid -s UUID -o value "$DATA_DEVICE")
	mkdir -p /var/lib/postgresql
	if ! grep -q "$uuid" /etc/fstab; then
		echo "UUID=$uuid /var/lib/postgresql ext4 defaults,nofail,discard,noatime 0 2" >>/etc/fstab
	fi
	mountpoint -q /var/lib/postgresql || mount /var/lib/postgresql
fi

# ---------------------------------------------------------------------------------------------
log "PostgreSQL $PG_VERSION and pgBackRest from the PGDG repository"
if [[ ! -f /etc/apt/sources.list.d/pgdg.sources && ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
	/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
fi
apt-get install -y -q "postgresql-$PG_VERSION" pgbackrest
chown postgres:postgres /var/lib/postgresql

# ---------------------------------------------------------------------------------------------
log "Postgres configuration"
vpc_ip=$(curl -sf --max-time 5 http://169.254.169.254/metadata/v1/interfaces/private/0/ipv4/address || true)
[[ -n $vpc_ip ]] || die "could not read the VPC IP from the DO metadata service (is the Droplet in a VPC?)"

mem_mb=$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)
maintenance_mb=$((mem_mb / 16))
((maintenance_mb < 512)) && maintenance_mb=512
((maintenance_mb > 2048)) && maintenance_mb=2048

cat >"$PG_CONF_DIR/conf.d/10-pg-ops.conf" <<EOF
# Managed by infra/postgres/provision.sh; edits are overwritten on the next run.
listen_addresses = 'localhost,$vpc_ip'
max_connections = 100
password_encryption = scram-sha-256

# Tuning for ${mem_mb}MB RAM
shared_buffers = $((mem_mb / 4))MB
effective_cache_size = $((mem_mb * 3 / 4))MB
work_mem = 16MB
maintenance_work_mem = ${maintenance_mb}MB
random_page_cost = 1.1
wal_compression = zstd

shared_preload_libraries = 'pg_stat_statements'
EOF

if [[ $DB_ROLE == prod ]]; then
	cat >"$PG_CONF_DIR/conf.d/20-archive.conf" <<'EOF'
# Managed by infra/postgres/provision.sh
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=main archive-push %p'
archive_timeout = 60
EOF
else
	# A restored copy must never push WAL into the prod repository.
	rm -f "$PG_CONF_DIR/conf.d/20-archive.conf"
	cat >"$PG_CONF_DIR/conf.d/90-test.conf" <<'EOF'
# Managed by infra/postgres/provision.sh
archive_mode = off
EOF
fi

hba=$PG_CONF_DIR/pg_hba.conf
sed -i '/^# BEGIN pg-ops/,/^# END pg-ops/d' "$hba"
cat >>"$hba" <<EOF
# BEGIN pg-ops (managed by infra/postgres/provision.sh)
host    all             all             $VPC_CIDR            scram-sha-256
# END pg-ops
EOF

# ---------------------------------------------------------------------------------------------
log "pgBackRest"
install -d -m 750 -o postgres -g postgres /etc/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
umask 027
cat >/etc/pgbackrest/pgbackrest.conf <<EOF
# Managed by infra/postgres/provision.sh ($DB_ROLE)
[global]
repo1-type=s3
repo1-s3-endpoint=$SPACES_ENDPOINT
repo1-s3-region=us-east-1
repo1-s3-bucket=$SPACES_BUCKET
repo1-s3-key=$SPACES_KEY
repo1-s3-key-secret=$SPACES_SECRET
repo1-path=$SPACES_REPO_PATH
repo1-retention-full=4
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$PGBACKREST_CIPHER_PASS
compress-type=zst
process-max=4
start-fast=y
log-level-console=info
log-level-file=detail

[main]
pg1-path=$PG_DATA
EOF
umask 022
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
chmod 640 /etc/pgbackrest/pgbackrest.conf

# Restart after pgBackRest is configured, so archive_command works from the first WAL segment.
systemctl enable "$PG_SERVICE"
systemctl restart "$PG_SERVICE"

# ---------------------------------------------------------------------------------------------
log "Ops scripts -> $INSTALL_DIR"
install -d -m 755 "$INSTALL_DIR"
install -m 755 "$HERE/refresh-test-db.sh" "$HERE/check-backup-freshness.sh" "$INSTALL_DIR/"
install -m 644 "$HERE/sanitize.sql" "$INSTALL_DIR/"

if [[ $DB_ROLE == prod ]]; then
	# ---------------------------------------------------------------------------------------------
	log "Roles and database"
	# Passwords go through stdin, not argv, so they don't show up in the process list.
	sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<EOF
\set owner_pw '$OWNER_PASSWORD'
\set app_pw '$APP_PASSWORD'
\set ro_pw '$READONLY_PASSWORD'
SELECT format('CREATE ROLE %I LOGIN', r) FROM unnest(ARRAY['$OWNER_ROLE', '$APP_ROLE', '$READONLY_ROLE']) r
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec
ALTER ROLE $OWNER_ROLE PASSWORD :'owner_pw';
ALTER ROLE $APP_ROLE PASSWORD :'app_pw';
ALTER ROLE $READONLY_ROLE PASSWORD :'ro_pw';
SELECT 'CREATE DATABASE $DB_NAME OWNER $OWNER_ROLE' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$DB_NAME') \gexec
EOF
	sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB_NAME" <<EOF
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB_NAME TO $APP_ROLE, $READONLY_ROLE;
GRANT USAGE ON SCHEMA public TO $APP_ROLE, $READONLY_ROLE;
-- Tables are created by migrations running as the owner role; these cover existing and future ones.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $APP_ROLE;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $APP_ROLE;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO $READONLY_ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER_ROLE IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $APP_ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER_ROLE IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $APP_ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER_ROLE IN SCHEMA public GRANT SELECT ON TABLES TO $READONLY_ROLE;
EOF

	# ---------------------------------------------------------------------------------------------
	log "Backup stanza and first full backup"
	sudo -u postgres pgbackrest --stanza=main stanza-create
	sudo -u postgres pgbackrest --stanza=main check
	if [[ $(sudo -u postgres pgbackrest --stanza=main info --output=json | jq '.[0].backup | length') == 0 ]]; then
		sudo -u postgres pgbackrest --stanza=main --type=full backup
	fi

	cat >/etc/cron.d/pg-ops <<'EOF'
# Managed by infra/postgres/provision.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * 0    postgres  pgbackrest --stanza=main --type=full backup
0 2 * * 1-6  postgres  pgbackrest --stanza=main --type=diff backup
15 * * * *   root      /opt/pg-ops/check-backup-freshness.sh >>/var/log/pgbackrest/freshness.log 2>&1
EOF
else
	# The test database's roles and data come from the prod backup; refresh-test-db.sh restores it,
	# sanitizes it and resets the role passwords to the test values in /etc/pg-ops.env.
	cat >/etc/cron.d/pg-ops <<'EOF'
# Managed by infra/postgres/provision.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# Sunday after the 02:00 full backup on prod
0 6 * * 0    root  /opt/pg-ops/refresh-test-db.sh >>/var/log/pg-ops-refresh.log 2>&1
EOF
fi
chmod 644 /etc/cron.d/pg-ops

# ---------------------------------------------------------------------------------------------
log "DigitalOcean monitoring agent"
if ! systemctl is-active --quiet do-agent; then
	curl -sSL https://repos.insights.digitalocean.com/install.sh | bash
fi

log "Done ($DB_ROLE)."
if [[ $DB_ROLE == test ]]; then
	echo "Run /opt/pg-ops/refresh-test-db.sh once to load the first sanitized copy of prod."
fi
echo "Set DO Monitoring alerts for disk > 80%, CPU and memory if you haven't already."
