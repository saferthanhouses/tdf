# Farm website API (email signups). Public, behind the edge Caddy at <farm site>/api. Also used for
# migrations (see farm-migrate in infra/platform/compose.yaml).
# Build from the repo root: docker build -f apps/farm-api/Dockerfile .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Every workspace's package.json is needed for npm ci to match the lockfile; only this one is installed.
# Dev dependencies stay: the API runs TypeScript with tsx, and migrations use kysely-ctl.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/barnbooks-web/package.json apps/barnbooks-web/
COPY apps/farm-api/package.json apps/farm-api/
COPY apps/farm-site/package.json apps/farm-site/
COPY packages/database-client/package.json packages/database-client/
RUN npm ci --include=dev -w farm-api --include-workspace-root \
	&& npm cache clean --force

COPY tsconfig.json ./
COPY apps/farm-api apps/farm-api

USER node
EXPOSE 3002
CMD ["node_modules/.bin/tsx", "apps/farm-api/index.ts"]
