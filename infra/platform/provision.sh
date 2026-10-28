#!/usr/bin/env bash
# Provisions the platform Droplet (Ubuntu 24.04 LTS): a Docker host running one Postgres for every
# monorepo app, the apps themselves, a public Caddy edge, and Tailscale for private apps.
#
#   ssh root@<droplet> 'mkdir -p /opt/platform'
#   scp infra/platform/platform.env.example root@<droplet>:/opt/platform/.env    # then fill it in
#   scp infra/platform/provision.sh root@<droplet>:/root/
#   ssh root@<droplet> 'chmod 600 /opt/platform/.env && /root/provision.sh'
#
# The first run creates a deploy key and stops so you can add it to GitHub (read-only); run it again
# afterwards. Safe to re-run: config is rewritten, existing data, roles and keys are kept, and an
# existing filesystem on the data volume is never reformatted.
#
# Not covered here (DigitalOcean control panel or doctl): the Block Storage Volume, the Cloud Firewall
# (80/443 open; 22 only from your IP until Tailscale SSH works, then closed), the Spaces bucket in another
# region with versioning on, and DO Monitoring alert policies.
set -euo pipefail

ENV_FILE=${PLATFORM_ENV:-/opt/platform/.env}
PLATFORM_DIR=/opt/platform
REPO_DIR=$PLATFORM_DIR/repo
DEPLOY_KEY=/root/.ssh/platform_deploy

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root"
[[ -r $ENV_FILE ]] || die "missing $ENV_FILE (copy platform.env.example and fill it in)"
# shellcheck source=platform.env.example
source "$ENV_FILE"

for var in ADMIN_USER REPO_URL POSTGRES_SUPERUSER_PASSWORD PGDATA_DIR STATE_DIR SPACES_ENDPOINT SPACES_BUCKET \
	SPACES_REPO_PATH SPACES_KEY SPACES_SECRET PGBACKREST_CIPHER_PASS FARM_SITE_DOMAIN ACME_EMAIL; do
	[[ -n ${!var:-} ]] || die "$var is not set in $ENV_FILE"
done
[[ $POSTGRES_SUPERUSER_PASSWORD =~ ^[A-Za-z0-9_.~+=-]{16,}$ ]] ||
	die "POSTGRES_SUPERUSER_PASSWORD must be 16+ characters of [A-Za-z0-9_.~+=-]"

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
apt-get install -y -q ca-certificates curl gnupg git jq unattended-upgrades fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades
systemctl enable --now fail2ban

# ---------------------------------------------------------------------------------------------
log "Docker Engine and Compose (Docker's apt repository)"
if [[ ! -f /etc/apt/sources.list.d/docker.list ]]; then
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	# shellcheck source=/dev/null
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
		>/etc/apt/sources.list.d/docker.list
	apt-get update -q
fi
apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl enable docker
systemctl restart docker
usermod -aG docker "$ADMIN_USER"

# ---------------------------------------------------------------------------------------------
log "Tailscale (host SSH over the tailnet)"
if ! command -v tailscale >/dev/null; then
	curl -fsSL https://tailscale.com/install.sh | sh
fi
if [[ -n ${TS_AUTHKEY_HOST:-} ]] && ! tailscale status >/dev/null 2>&1; then
	tailscale up --authkey "$TS_AUTHKEY_HOST" --ssh --hostname "${TS_HOSTNAME:-platform}"
fi

# ---------------------------------------------------------------------------------------------
if [[ -n ${DATA_DEVICE:-} ]]; then
	log "Data volume $DATA_DEVICE -> $PGDATA_DIR"
	[[ -b $DATA_DEVICE ]] || die "$DATA_DEVICE is not a block device (is the volume attached?)"
	if ! blkid "$DATA_DEVICE" &>/dev/null; then
		mkfs.ext4 -q "$DATA_DEVICE"
	fi
	uuid=$(blkid -s UUID -o value "$DATA_DEVICE")
	mkdir -p "$PGDATA_DIR"
	if ! grep -q "$uuid" /etc/fstab; then
		echo "UUID=$uuid $PGDATA_DIR ext4 defaults,nofail,discard,noatime 0 2" >>/etc/fstab
	fi
	mountpoint -q "$PGDATA_DIR" || mount "$PGDATA_DIR"
fi
mkdir -p "$PGDATA_DIR"
# uid/gid 999 is postgres inside the official image.
chown 999:999 "$PGDATA_DIR"
chmod 700 "$PGDATA_DIR"

# ---------------------------------------------------------------------------------------------
log "Repository checkout ($REPO_URL)"
install -d -m 700 /root/.ssh
if [[ ! -f $DEPLOY_KEY ]]; then
	ssh-keygen -q -t ed25519 -N '' -C "platform-deploy@$(hostname)" -f "$DEPLOY_KEY"
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null >/root/.ssh/known_hosts.github
export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=/root/.ssh/known_hosts.github"
if [[ ! -d $REPO_DIR/.git ]]; then
	if ! git clone --branch "${REPO_BRANCH:-main}" "$REPO_URL" "$REPO_DIR"; then
		echo
		echo "Add this key to the repository as a read-only deploy key (GitHub > Settings > Deploy keys),"
		echo "then run provision.sh again:"
		echo
		cat "$DEPLOY_KEY.pub"
		exit 1
	fi
fi
git -C "$REPO_DIR" config core.sshCommand "$GIT_SSH_COMMAND"

cat >/usr/local/bin/platform-compose <<EOF
#!/bin/sh
# docker compose for the platform stack (installed by infra/platform/provision.sh)
exec docker compose --project-directory $REPO_DIR/infra/platform -f $REPO_DIR/infra/platform/compose.yaml --env-file $ENV_FILE "\$@"
EOF
chmod 755 /usr/local/bin/platform-compose

# ---------------------------------------------------------------------------------------------
log "Postgres tuning and pgBackRest config -> $STATE_DIR"
install -d -m 755 "$STATE_DIR" "$STATE_DIR/postgres"
install -d -m 750 -o 999 -g 999 "$STATE_DIR/pgbackrest"

# Postgres shares the Droplet with the apps: size its memory from the container limit.
db_limit=${DB_MEM_LIMIT:-1g}
case $db_limit in
*g | *G) db_mb=$((${db_limit%[gG]} * 1024)) ;;
*m | *M) db_mb=${db_limit%[mM]} ;;
*) die "DB_MEM_LIMIT must look like 1g or 768m" ;;
esac
cat >"$STATE_DIR/postgres/tuning.conf" <<EOF
# Written by provision.sh for DB_MEM_LIMIT=$db_limit
shared_buffers = $((db_mb / 4))MB
effective_cache_size = $((db_mb * 3 / 4))MB
maintenance_work_mem = $((db_mb / 16))MB
EOF

umask 027
cat >"$STATE_DIR/pgbackrest/pgbackrest.conf" <<EOF
# Written by provision.sh
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
process-max=2
start-fast=y
log-level-console=info
log-level-file=detail

[main]
pg1-path=/var/lib/postgresql/18/docker
EOF
umask 022
chown 999:999 "$STATE_DIR/pgbackrest/pgbackrest.conf"
chmod 640 "$STATE_DIR/pgbackrest/pgbackrest.conf"

# ---------------------------------------------------------------------------------------------
log "Postgres"
platform-compose build db
platform-compose up -d --wait db
for app in ${APP_DATABASES:-}; do
	"$REPO_DIR/infra/platform/create-app-db.sh" "$app"
done

log "Backup stanza and first full backup"
pgbackrest() { platform-compose exec -T -u postgres db pgbackrest --stanza=main "$@"; }
pgbackrest stanza-create
pgbackrest check
if [[ $(pgbackrest info --output=json | jq '.[0].backup | length') == 0 ]]; then
	pgbackrest --type=full backup
fi

cat >/etc/cron.d/platform <<'EOF'
# Installed by infra/platform/provision.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 2 * * 0    root  platform-compose exec -T -u postgres db pgbackrest --stanza=main --type=full backup >>/var/log/platform-backup.log 2>&1
0 2 * * 1-6  root  platform-compose exec -T -u postgres db pgbackrest --stanza=main --type=diff backup >>/var/log/platform-backup.log 2>&1
15 * * * *   root  /opt/platform/repo/infra/postgres/check-backup-freshness.sh >>/var/log/platform-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/platform
cat >/etc/logrotate.d/platform <<'EOF'
/var/log/platform-backup.log {
	weekly
	rotate 8
	compress
	missingok
	notifempty
}
EOF

# ---------------------------------------------------------------------------------------------
log "DigitalOcean monitoring agent"
if ! systemctl is-active --quiet do-agent; then
	curl -sSL https://repos.insights.digitalocean.com/install.sh | bash
fi

log "Done. Deploy the apps with: $REPO_DIR/infra/platform/deploy.sh"
[[ -n ${TS_AUTHKEY_HOST:-} ]] || echo "TS_AUTHKEY_HOST is empty: run 'tailscale up --ssh' to join the tailnet."
echo "Then close port 22 in the Cloud Firewall and use 'ssh $ADMIN_USER@${TS_HOSTNAME:-platform}' over Tailscale."
