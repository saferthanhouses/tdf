# barnbooks API. Also used for migrations (see barnbooks-migrate in infra/platform/compose.yaml).
# Build from the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Every workspace's package.json is needed for npm ci to match the lockfile; only these are installed.
# Dev dependencies stay: the API runs TypeScript with tsx, and migrations use kysely-ctl.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/barnbooks-web/package.json apps/barnbooks-web/
COPY apps/farm-site/package.json apps/farm-site/
COPY packages/database-client/package.json packages/database-client/
RUN npm ci --include=dev -w barnbooks-api -w @tdf-mono/db-client --include-workspace-root \
	&& npm cache clean --force

COPY tsconfig.json ./
COPY packages/database-client packages/database-client
COPY apps/api apps/api

USER node
EXPOSE 3001
CMD ["node_modules/.bin/tsx", "apps/api/index.ts"]
