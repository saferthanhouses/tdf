#!/usr/bin/env bash
# Copies the files OpenTofu generated to the platform Droplet and runs provision.sh there.
#
#   ./bootstrap.sh [--admin] [droplet-ip]
#
# First run: connects as root (the only user on a new Droplet). provision.sh then disables root login,
# so later runs (after changing variables and re-applying) need --admin to connect as ADMIN_USER with
# sudo. The IP defaults to `tofu output -raw droplet_ip`.
#
# Secrets go over SSH rather than Droplet user_data, which anything on the Droplet can read.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=$HERE/out/platform.env
DEPLOY_KEY=$HERE/out/deploy_key
PROVISION=$HERE/../platform/provision.sh

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

as_admin=0
if [[ ${1:-} == --admin ]]; then
	as_admin=1
	shift
fi
for f in "$ENV_FILE" "$DEPLOY_KEY" "$DEPLOY_KEY.pub" "$PROVISION"; do
	[[ -f $f ]] || die "missing $f (run tofu apply first)"
done

ip=${1:-$(cd "$HERE" && tofu output -raw droplet_ip)}
[[ -n $ip ]] || die "no Droplet IP"
admin=$(sed -n 's/^ADMIN_USER=//p' "$ENV_FILE")

ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
# A plain string, not an array: an empty array is "unbound" under set -u in macOS's bash 3.2.
if ((as_admin)); then
	target=$admin@$ip
	sudo=sudo
else
	target=root@$ip
	sudo=
fi

echo "==> copying platform.env, deploy key and provision.sh to $target"
staging=$(ssh "${ssh_opts[@]}" "$target" 'mktemp -d')
scp -q "${ssh_opts[@]}" "$ENV_FILE" "$DEPLOY_KEY" "$DEPLOY_KEY.pub" "$PROVISION" "$target:$staging/"

# Install with tight permissions, then run provision.sh (re-runnable).
ssh -t "${ssh_opts[@]}" "$target" "$sudo bash -euo pipefail -c '
	install -d -m 700 /opt/platform /root/.ssh
	install -m 600 $staging/platform.env /opt/platform/.env
	install -m 600 $staging/deploy_key /root/.ssh/platform_deploy
	install -m 644 $staging/deploy_key.pub /root/.ssh/platform_deploy.pub
	install -m 700 $staging/provision.sh /root/provision.sh
	rm -rf $staging
	/root/provision.sh
'"

echo
echo "Done. Before closing anything, check: ssh $admin@$ip"
echo "Then deploy: ssh $admin@$ip sudo /opt/platform/repo/infra/platform/deploy.sh"
