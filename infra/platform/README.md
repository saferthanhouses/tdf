# Platform Droplet

One DigitalOcean Droplet runs every monorepo app in Docker Compose, with one Postgres shared between them (a database per app). Public sites are served on the internet through Caddy. Private apps are reachable only from your devices over Tailscale. Backups go to Spaces with pgBackRest, and a weekly restore test on a short-lived Droplet proves they restore.

```
                         internet                          your tailnet (phone, laptop)
                            │ 80/443                                │
┌───────────────────────────┼─────── platform Droplet ──────────────┼─────────────────────┐
│                      ┌────▼────┐                           ┌──────▼───────┐             │
│                      │  caddy  │ public network            │ ts-barnbooks │ barnbooks   │
│                      └────┬────┘                           └──────┬───────┘ network     │
│                      ┌────▼──────┐                         ┌──────▼────────┐            │
│                      │ farm-site │                         │ barnbooks-web │──/api──┐   │
│                      └───────────┘                         └───────────────┘        │   │
│                                                            ┌────────────────┐       │   │
│   backend network (no published ports)  ┌──────────────────│ barnbooks-api  │◄──────┘   │
│   ┌───────────────────────┐             │                  └────────────────┘           │
│   │ db: Postgres 18       │◄────────────┘                                               │
│   │ + pgBackRest          │ data on a Block Storage Volume (/mnt/pgdata)                │
│   └──────────┬────────────┘                                                             │
└──────────────┼──────────────────────────────────────────────────────────────────────────┘
               │ WAL + weekly full / daily diff (encrypted)
               ▼
   Spaces: backup bucket (another region, versioned) ──read-only──► weekly restore-test Droplet
   Spaces: dumps bucket  ◄── sanitized pg_dump of each database ──┘  (created and destroyed by CI)
```

## Files

| Path | What it is |
|---|---|
| `infra/platform/compose.yaml` | The stack. Run it through `platform-compose` (installed by provision.sh), which adds `/opt/platform/.env` |
| `infra/platform/Caddyfile` | Public sites |
| `infra/platform/tailscale/*.json` | Tailscale serve config, one per private app |
| `infra/platform/platform.env.example` | Settings and secrets, copied to `/opt/platform/.env` |
| `infra/platform/provision.sh` | One-time host setup (re-runnable) |
| `infra/platform/deploy.sh` | Pull, build, create app databases, migrate, restart |
| `infra/platform/create-app-db.sh` | One app's database with `<app>_owner` / `_app` / `_readonly` roles |
| `infra/postgres/` | The Postgres + pgBackRest image, its config, `sanitize/<db>.sql`, the freshness check and the restore test |
| `.github/workflows/restore-test.yml` | Weekly restore test on a short-lived Droplet |
| `apps/*/Dockerfile` | App images (built on the Droplet) |

## One-time setup

**DigitalOcean**
1. A Droplet (Ubuntu 24.04, 2–4 GB to start) with your SSH key, plus a **Block Storage Volume** attached but not formatted or mounted; `provision.sh` does that.
2. **Cloud Firewall**: inbound 80 and 443 from anywhere, and 22 from your IP only. Close 22 once Tailscale SSH works.
3. **Spaces**, in a different region from the Droplet:
   - a **backup bucket** with versioning on, so a compromised server can't destroy its own history;
   - a separate **dumps bucket**, with a lifecycle rule expiring objects after a few weeks.
4. **Spaces keys**, each scoped to one bucket:
   - read/write on the backup bucket, for the Droplet;
   - **read-only** on the backup bucket, for the restore test;
   - read/write on the dumps bucket, for the restore test.
5. An **API token** that can create and delete Droplets, for the restore-test workflow.

**Tailscale**: create two auth keys, one for the host (`TS_AUTHKEY_HOST`) and one for each private app's sidecar (`TS_AUTHKEY_BARNBOOKS`), and enable HTTPS certificates in the tailnet's DNS settings.

**Healthchecks.io**: two checks.
- "platform backups": period 1 hour, grace 2 hours → `HC_BACKUP_URL` in `/opt/platform/.env`.
- "restore test": period 1 week, grace 1 day → the `HC_RESTORE_URL` GitHub secret.

**GitHub** (repository settings):
- **Deploy key**: printed by `provision.sh`. Add it as read-only.
- **Secrets**: `DO_TOKEN`, `SPACES_RO_KEY`, `SPACES_RO_SECRET`, `PGBACKREST_CIPHER_PASS`, `DUMPS_KEY`, `DUMPS_SECRET`, `HC_RESTORE_URL`.
- **Variables**: `SPACES_ENDPOINT`, `SPACES_BUCKET`, `SPACES_REPO_PATH`, `DUMPS_ENDPOINT_URL` (e.g. `https://ams3.digitaloceanspaces.com`), `DUMPS_BUCKET`, `DO_REGION`, `DO_SSH_KEY_FINGERPRINT` (any key on your account; without one DO emails a root password for each test Droplet), and optionally `NO_PII_DATABASES`.

## Provisioning

```sh
ssh root@<droplet> 'mkdir -p /opt/platform'
scp infra/platform/platform.env.example root@<droplet>:/opt/platform/.env
ssh root@<droplet> 'chmod 600 /opt/platform/.env && vi /opt/platform/.env'   # passwords: openssl rand -hex 32
scp infra/platform/provision.sh root@<droplet>:/root/
ssh root@<droplet> /root/provision.sh
```

The first run prints a deploy key and stops. Add the key to GitHub, then run `provision.sh` again.

Before closing that session, check `ssh <ADMIN_USER>@<droplet>` works: the script disables root login. Then deploy:

```sh
sudo /opt/platform/repo/infra/platform/deploy.sh
```

barnbooks is then at `https://barnbooks.<your-tailnet>.ts.net` on your devices, and farm-site at `FARM_SITE_DOMAIN` (point its DNS at the Droplet first so Caddy can get a certificate).

Keep `PGBACKREST_CIPHER_PASS` in your password manager. Without it the backups can't be decrypted.

## Deploying changes

Merge to `main`, then on the Droplet run `sudo /opt/platform/repo/infra/platform/deploy.sh`. It pulls, rebuilds with fresh base images (so Postgres minor releases arrive here), creates any new app databases, runs every `*-migrate` service, and restarts what changed.

## Adding an app

1. A `Dockerfile` for it under `apps/`.
2. Services in `compose.yaml`:
   - **Public:** put it on the `public` network and add a site block to the `Caddyfile`.
   - **Private:** give it its own network and a `ts-<app>` sidecar like `ts-barnbooks`, plus `tailscale/<app>.json`.
3. If it needs a database:
   - add the app to `APP_DATABASES` and its three passwords to `/opt/platform/.env`;
   - give it an `<app>-migrate` service (tools profile) that connects as `<app>_owner`; the app itself connects as `<app>_app` on the `backend` network;
   - add `infra/postgres/sanitize/<app>.sql`, or list the database in `NO_PII_DATABASES` if it holds no personal data. The restore test fails until you do.

## Backups and restores

- Postgres archives WAL continuously, so it can lose at most about 1 minute of data. Full backups run Sundays at 02:00 and diffs daily; the last 4 fulls are kept.
- `check-backup-freshness.sh` runs hourly and alerts when the latest backup is over 26h old, the latest full over 8 days old, or WAL archiving is failing.

Restoring the platform Droplet in place:

```sh
platform-compose stop
platform-compose run --rm --no-deps -u postgres db pgbackrest --stanza=main --delta restore
#   point in time: add  --type=time --target="2026-10-15 12:00:00+00" --target-action=promote
platform-compose up -d
```

Moving to a new Droplet works the same way after `provision.sh` on the new host.

## Restore test

Every Sunday at 06:00 UTC (or on demand from the Actions tab), the workflow creates a small Droplet, which:
1. restores the latest backup using the read-only key;
2. replays WAL with Postgres accepting no connections, then disconnects it from the network;
3. runs `sanitize/<db>.sql` on each database;
4. uploads a `pg_dump` of each to the dumps bucket under `restore-test/<date>-<run id>/`;
5. powers off.

The workflow then destroys the Droplet whatever happened. A failed run alerts through Healthchecks and fails the workflow.

The dumps are what developers should use instead of production data.

## Personal data

`sanitize/barnbooks.sql` replaces vendor names and match texts, bank descriptions, notes, import filenames and account numbers. It keeps dates, amounts and categories, and vendor matching still works on the result.

It refuses to run if any text, JSON or array column in a table isn't on its reviewed list. So when a migration adds a column, add it there: either scrub it or list it as safe.

## Tests

```sh
infra/platform/test/e2e.sh                     # the whole stack locally, with an S3 gateway standing in for Spaces
infra/postgres/test/test-sanitize.sh           # sanitize/barnbooks.sql on a throwaway copy of the dev database
infra/postgres/test/test-backup-freshness.sh   # freshness check against stand-in commands
shellcheck -x infra/postgres/*.sh infra/postgres/test/*.sh infra/platform/*.sh infra/platform/test/*.sh
```

Not covered by these tests:
- **`provision.sh`'s host steps:** Docker and Tailscale installation, the volume, SSH hardening.
- **Tailscale serve**, and Caddy's public certificates.
- **The workflow's Droplet lifecycle**, and real Spaces.

Check these on the first real deploy.

## Not included yet

- A real login for private apps. Tailscale is the only access control.
- PgBouncer, postgres_exporter/Grafana, and DO Monitoring alert policies (the agent is installed; add the alerts in the control panel).
- A standby replica. When an app outgrows the shared Droplet, give it its own: `pg_dump` its database, or restore the whole cluster with pgBackRest.
