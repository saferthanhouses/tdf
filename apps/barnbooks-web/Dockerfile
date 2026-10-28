# barnbooks web app: static Vite build served by Caddy, which also proxies /api to the API container.
# Build from the repo root: docker build -f apps/barnbooks-web/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/barnbooks-web/package.json apps/barnbooks-web/
COPY apps/farm-site/package.json apps/farm-site/
COPY packages/database-client/package.json packages/database-client/
RUN npm ci -w barnbooks-web -w @tdf-mono/db-client --include-workspace-root
COPY tsconfig.json ./
COPY packages/database-client packages/database-client
COPY apps/barnbooks-web apps/barnbooks-web
RUN npm run build -w barnbooks-web

FROM caddy:2-alpine
COPY apps/barnbooks-web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/barnbooks-web/dist /srv
