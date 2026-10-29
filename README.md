# TDF monorepo

Software for Thistledown Farm, kept in one repository: the public farm website, **barnbooks** (the farm's private accounting app), the shared database code, and the infrastructure that runs it all on a single DigitalOcean Droplet.

## Projects

| Path | What it is | Tech | Audience |
|---|---|---|---|
| [`apps/farm-site`](apps/farm-site/README.md) | The farm's public website | Astro (static) | Public |
| `apps/barnbooks-web` | barnbooks UI: import bank CSVs, categorise and post transactions, ledger | React 19, Vite | Private (Tailscale) |
| `apps/api` | barnbooks API (`barnbooks-api`) | Hono on Node, Kysely, zod | Private |
| `packages/database-client` | `@tdf-mono/db-client`: database types, client, migrations, seed scripts | Kysely, node-postgres, kysely-ctl | Shared |
| [`barnbooks`](barnbooks/README.md) | The original Google Sheets version of barnbooks (Apps Script), being replaced by the app above | TypeScript for Apps Script | Legacy |
| [`fieldnotes`](fieldnotes/README.md) | Notes for a future field-planning app | – | Idea |
| [`infra`](infra/platform/README.md) | Local dev database, production platform, backups, OpenTofu | Docker Compose, Postgres 18, pgBackRest, Caddy, Tailscale, OpenTofu | Ops |

## Layout

```
.
├── apps/
│   ├── api/                  barnbooks API (Dockerfile for production)
│   ├── barnbooks-web/        barnbooks UI (Dockerfile: Vite build served by Caddy)
│   └── farm-site/            public Astro site (Dockerfile, own lockfile too)
├── packages/
│   └── database-client/      @tdf-mono/db-client: src/, migrations/, seed/
├── barnbooks/                legacy Google Apps Script (not an npm workspace)
├── fieldnotes/               notes only
├── infra/
│   ├── compose.yaml          local development Postgres
│   ├── postgres/             production Postgres image, sanitize/, freshness check, restore test
│   ├── platform/             production compose stack, provision.sh, deploy.sh (see its README)
│   └── terraform/            OpenTofu: DigitalOcean + GitHub settings, bootstrap.sh
├── .github/workflows/        weekly restore test of production backups
├── package.json              npm workspaces root and shared scripts
├── tsconfig.json             base TypeScript settings
├── .env.dev.example          template for local settings
└── CLAUDE.md                 git workflow conventions
```

## Technologies

| Area | Used |
|---|---|
| Language and runtime | TypeScript 7, Node 24. `tsx` runs TypeScript directly in development and production (no build step for the API). |
| Monorepo | npm workspaces (`apps/*`, `packages/*`). No Turborepo or Nx. |
| Validation | zod, for API input and environment variables |
| Public site | Astro, static output |
| App UI | React 19, Vite |
| API | Hono on `@hono/node-server`, csv-parse for bank imports |
| Database | PostgreSQL (16 locally, 18 in production), Kysely query builder and migrations (`kysely-ctl`) |
| Production | One DigitalOcean Droplet running Docker Compose: Caddy (HTTPS for public sites), Tailscale (private apps), Postgres with pgBackRest backups to DigitalOcean Spaces |
| Infrastructure as code | OpenTofu (DigitalOcean resources, GitHub Actions settings, generated secrets) |
| CI | GitHub Actions (weekly restore test on a short-lived Droplet) |
| Testing | `node:test` via `tsx --test`, `tofu test`, shell tests and shellcheck for infra |

## Getting started

**Prerequisites:** Node 24 with npm, and Docker Desktop. For infrastructure work you'll also want OpenTofu, `doctl` and `shellcheck`.

```sh
npm install                                    # installs every workspace
docker compose -f infra/compose.yaml up -d     # dev Postgres on localhost:5432
cp .env.dev.example .env.dev                   # local settings (gitignored)
npm run db:migrate                             # create the barnbooks tables
```

Then, in separate terminals:

```sh
npm run barnbooks:api            # API on http://localhost:3001
npm run barnbooks:web            # UI on http://localhost:5180 (proxies /api to the API)
npm run dev -w farm-site         # public site on http://localhost:4321
```

**Real data:** `npm run db:seed:vendors` and `npm run db:seed:transactions` import the Google Sheet exports. Pass another ledger file to import it too, e.g. `npm run db:seed:transactions -- seed/2025_transactions.tsv`. These files hold real names, so they're gitignored and not in the repo; ask for them, or use a sanitized dump from production (see [Database](#database)).

## Root scripts

| Script | What it does |
|---|---|
| `npm run db:migrate` | Apply migrations to the database in `.env.dev` |
| `npm run db:migration:create -- <name>` | Create a new migration in `packages/database-client/migrations` |
| `npm run db:seed:vendors` / `db:seed:transactions [-- <file>]` | Import the Google Sheet exports, CSV or tab-separated with a header row (add `--dry-run` to preview). Ledger rows already imported from a bank CSV are skipped. |
| `npm run db:restore-from-prod [-- --run <run> --db <db>]` | Replace the dev database with the latest sanitized production dump (backs up dev first) |
| `npm run barnbooks:api` | Start the API with `.env.dev`, restarting on changes |
| `npm run barnbooks:web` | Start the UI dev server |

Workspace scripts run with `-w`, e.g. `npm test -w barnbooks-api`, `npm run typecheck -w barnbooks-web`, `npm run build -w farm-site`.

## Sharing code between projects

- Every directory under `apps/` and `packages/` is an **npm workspace**, so a single `npm install` at the root installs everything and links workspaces together in `node_modules`.
- **Shared packages** live in `packages/` and are named `@tdf-mono/<name>`. Apps depend on them by name with version `"*"`:
  ```json
  "dependencies": { "@tdf-mono/db-client": "*" }
  ```
- **Shared as source:** `@tdf-mono/db-client` points `main`/`types` at `src/index.ts`. Consumers use the TypeScript directly (the API through `tsx`, the web app through Vite, which only imports its types), so there's no build or publish step. A change in the package is picked up immediately.
- **Adding a package:** create `packages/<name>/package.json` with `"name": "@tdf-mono/<name>"`, add it to the consumer's dependencies, and run `npm install`.
- **Adding an app:** create `apps/<name>/` with its own `package.json`; for production, give it a `Dockerfile` and follow "Adding an app" in [infra/platform/README.md](infra/platform/README.md#adding-an-app).

## Secrets and configuration

| Where | How settings and secrets are handled |
|---|---|
| **Local development** | `.env.dev` (gitignored, from `.env.dev.example`). The root scripts load it with [dotenvx](https://dotenvx.com) (`dotenvx run -f .env.dev -- …`). `@tdf-mono/db-client` validates the `DB_*` variables with zod at startup and exits with a clear message if any are missing. |
| **Production** | `/opt/platform/.env` on the Droplet (root-only, 0600). It's generated by OpenTofu with random passwords and scoped keys (`infra/terraform/out/platform.env`) and copied over SSH by `bootstrap.sh`. Docker Compose gives each service only the variables it needs. |
| **Infrastructure** | OpenTofu reads API tokens from environment variables (`DIGITALOCEAN_TOKEN`, `GITHUB_TOKEN`, Spaces keys) and settings from `infra/terraform/terraform.tfvars` (gitignored). Its state holds every generated secret and is **encrypted** with `TF_VAR_state_passphrase`, which lives in the password manager. |
| **CI** | GitHub Actions secrets and variables for the restore-test workflow, set by OpenTofu rather than by hand. |

**Never commit:** `.env*` files (except `*.example`), `terraform.tfvars`, `*.tfstate`, `infra/terraform/out/`, the seed CSV/TSV files in `packages/database-client/seed/`, or `*.dump` files. These are all gitignored. Stage files by name rather than with `git add .`, so a stray file can't slip in.

## Database

- **Local:** Postgres 16 from `infra/compose.yaml` (user `myuser`, database `mydatabase`). Migrations and seeds connect as that user.
- **Production:**
  - One Postgres 18 instance shared by all apps, with **one database per app** and three roles each: `<app>_owner` runs migrations, `<app>_app` is the app's connection, `<app>_readonly` is for queries.
  - Migrations run during deploys as the owner role.
  - WAL archiving and nightly backups go to Spaces, and the weekly restore test proves they restore.
- **Changing the schema:**
  1. `npm run db:migration:create -- <name>`, then write `up` and `down` in the new file.
  2. Update the types in `packages/database-client/src/types/`.
  3. If the migration adds a text column, add it to `infra/postgres/sanitize/<app>.sql`. The restore test fails until you do.
- **Realistic data:** the weekly restore test uploads a **sanitized** `pg_dump` of each database to the dumps bucket, with personal data replaced and amounts kept. `npm run db:restore-from-prod` replaces your dev database with the latest one. It backs up the current dev data to `~/.cache/tdf/dev-db-backups/` first, and needs `SPACES_ACCESS_KEY_ID`/`SPACES_SECRET_ACCESS_KEY` exported. For fresher data, run the restore test first (GitHub → Actions → Restore test → Run workflow).

## Deployment

Production is a single Droplet set up with OpenTofu and Docker Compose:
- **Public sites** (farm-site) are served by Caddy with automatic HTTPS.
- **Private apps** (barnbooks) are reachable only over Tailscale.
- **Deploying:** merge to `main`, then run `deploy.sh` on the Droplet. It pulls, builds, migrates and restarts.

Everything about it is in **[infra/platform/README.md](infra/platform/README.md)**:
- first-time setup with OpenTofu, and the first-run gotchas;
- deploys, and adding apps;
- backups, restores and the restore test;
- logs and access.

## Testing

```sh
npm test -w barnbooks-api                     # CSV normalizers, vendor matching
npm test -w @tdf-mono/db-client               # Google Sheet import parsing
npm run typecheck -w barnbooks-api && npm run typecheck -w barnbooks-web
```

Infrastructure tests (sanitizing, backup checks, restoring dev from production, a full local run of the production stack, OpenTofu) are listed under [Tests in infra/platform/README.md](infra/platform/README.md#tests).

## Contributing

From [CLAUDE.md](CLAUDE.md):
- **Never commit to `main` directly.** Branch off an up-to-date `main` as `<project>/<type>/<short-description>`, e.g. `barnbooks/feat/vendor-patterns`, `infra/fix/tofu-first-run`.
- **Commit small, working steps** with Conventional Commits that name the project: `feat(barnbooks): …`, `fix(infra): …`, `docs(tdf): …`. Run tests and lint first.
- **Finish with a PR:** push with `git push -u origin <branch>` and open a pull request with a summary and test plan. Pull requests are reviewed before merging.

## Housekeeping

Small things to tidy up:
- The root `npm run dev` script points at an `index.ts` that doesn't exist.
- `dotenv-cli` is installed but unused; `@dotenvx/dotenvx` does the work.
- Local development uses Postgres 16, while production runs 18. Moving `infra/compose.yaml` to the production image (`infra/postgres`) would keep them in step.
