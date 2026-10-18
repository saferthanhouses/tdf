# Self-hosted Postgres on DigitalOcean

```
            ┌──────────── DO VPC (private network) ─────────────┐
 App ──────►│  prod-db Droplet           test-db Droplet         │
 Droplets   │  Postgres 18               Postgres 18, restored   │
            │  data on Block Volume      weekly + sanitized      │
            └──────────────┬───────────────────────▲─────────────┘
                           │ WAL + backups         │ restore (read-only key)
                           ▼                       │
                DO Spaces bucket (pgBackRest, encrypted, another region)
```

| File | Runs on | What it does |
|---|---|---|
| `provision.sh` | both, once (re-runnable) | Hardens SSH, installs Postgres + pgBackRest from PGDG, mounts the data volume, tunes for the Droplet's RAM, restricts access to the VPC, sets up roles, backups and cron |
| `check-backup-freshness.sh` | prod, hourly | Fails if the newest backup is over 26h old, the newest full over 8 days, the stanza is unhealthy, or WAL archiving is failing; pings Healthchecks.io |
| `refresh-test-db.sh` | test, weekly | Restores the latest prod backup (or a point in time), runs `sanitize.sql`, resets passwords to the test values, writes a sanitized dump for developers |
| `sanitize.sql` | test | Scrubs vendor names, bank descriptions, notes, filenames and account numbers; keeps dates, amounts and categories |
| `pg-ops.env.example` | both | Settings for all of the above, copied to `/etc/pg-ops.env` |

## One-time DigitalOcean setup

The scripts configure the Droplets themselves; set these up first in the control panel or with `doctl`:

1. **VPC** in your region; put both database Droplets and the app Droplets in it.
2. **Droplets**: Ubuntu 24.04. Prod on a General Purpose or Memory-Optimized plan (Basic uses shared CPU); test can be smaller. Add your SSH key.
3. **Block Storage Volume** for prod (and optionally test), attached to the Droplet but **not** formatted or mounted by DO; `provision.sh` does that.
4. **Cloud Firewall** on both database Droplets: inbound 5432 only from the app Droplets' tag, 22 only from your IP.
5. **Spaces bucket** in a *different region* from the Droplets, with **versioning on**, so a compromised server can't destroy its own backups.
6. **Two Spaces access keys** scoped to that bucket: read/write for prod, **read-only** for test.
7. **Healthchecks.io**: two checks.
   - "pg backups" (prod): period 1 hour, grace 2 hours → `HC_BACKUP_URL`
   - "pg test refresh" (test): period 1 week, grace 1 day → `HC_REFRESH_URL`

## Provisioning

```sh
scp -r infra/postgres root@<prod-ip>:/root/pg-ops
ssh root@<prod-ip>
cp /root/pg-ops/pg-ops.env.example /etc/pg-ops.env && chmod 600 /etc/pg-ops.env
vi /etc/pg-ops.env          # DB_ROLE=prod, keys, passwords (openssl rand -hex 32)
/root/pg-ops/provision.sh
```

Before closing that session, check `ssh <ADMIN_USER>@<prod-ip>` works: the script disables root login.

Then do the same on the test Droplet with `DB_ROLE=test`, the **read-only** Spaces key, the same `PGBACKREST_CIPHER_PASS`, and **different** role passwords, and run `/opt/pg-ops/refresh-test-db.sh` once.

Keep `PGBACKREST_CIPHER_PASS` in your password manager. Without it the backups can't be decrypted.

## Roles

| Role | Use |
|---|---|
| `barnbooks_owner` | Runs migrations (`npm run db:migrate`); owns the tables |
| `barnbooks_app` | The API's connection: read/write data, no DDL |
| `barnbooks_readonly` | Reporting and ad-hoc queries |

Run migrations as the owner role: the app and read-only grants on new tables come from default privileges on objects the owner creates.

## Restoring prod

```sh
systemctl stop postgresql@18-main
sudo -u postgres pgbackrest --stanza=main --delta restore                       # latest
sudo -u postgres pgbackrest --stanza=main --delta --type=time \
  --target="2026-10-15 12:00:00+00" --target-action=promote restore              # point in time
systemctl start postgresql@18-main
```

The weekly test refresh runs the same restore, so a successful refresh means the backups restore.

## Keeping `sanitize.sql` current

`sanitize.sql` refuses to run if any text, JSON or array column isn't on its reviewed list. When a migration adds one, add it to `sanitize.sql`: either scrub it or list it as safe. Otherwise the next refresh fails, Healthchecks alerts, and the test database stays reachable only from localhost.

## Tests

```sh
infra/postgres/test/test-sanitize.sh           # needs the dev DB from infra/compose.yaml; works on a throwaway copy
infra/postgres/test/test-backup-freshness.sh   # stand-in pgbackrest/psql/curl; no setup
shellcheck -x infra/postgres/*.sh infra/postgres/test/*.sh
```

`provision.sh` and `refresh-test-db.sh` need a real Droplet (systemd, the DO metadata service, a Spaces bucket), so they are linted but not run by these tests. Run them on fresh Droplets before relying on them.

## Not included yet

- A nightly `pg_dump -Fc` of prod to a separate prefix (portable across major versions, single-table restores).
- PgBouncer: the barnbooks API is a single Node process with its own pool, so it isn't needed yet.
- `postgres_exporter` / Grafana, and DO Monitoring alert policies (the agent is installed; add the alerts in the control panel).
- A streaming replica for faster failover.
