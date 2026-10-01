# TDF Monorepo

## Structure


my-monorepo/
├── apps/
│   ├── app/                 # Frontend client application (e.g., Next.js / React)
│   │   ├── Dockerfile
│   │   └── compose.yaml     # Mounts frontend, connects to shared network
│   └── api/                 # Backend service (e.g., Node.js / Express / Go)
│       ├── Dockerfile
│       └── compose.yaml     # Mounts API, connects to shared network
├── infra/
│   └── compose.yaml         # Central database service (PostgreSQL, Redis, etc.)
├── packages/                # Shared internal code (not deployed standalone)
│   ├── database-client/     # Prisma/Kysely schemas & migrations folder
│   ├── config/              # Shared Eslint, Tsconfig, Prettier rules
│   └── ui/                  # Shared UI components component library
├── turbo.json (or nx.json)  # Monorepo task orchestration configuration
├── package.json             # Root workspace definitions
└── .gitignore               # Root git exclusions (.env, postgres_data)

## Secrets
what do we use for env variables?

## Tasks

### Barnbooks API & DB
Setup local and production DB 

Migrate existing csv data to DB 
Setup google sheets csv Upload Request to API 
