# Farm website: static Astro build served by Caddy. Public, behind the platform's edge Caddy.
# Build from this directory: docker build apps/farm-site
FROM node:24-slim AS build
WORKDIR /site
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /site/dist /srv
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":80"]
