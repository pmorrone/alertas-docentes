# syntax=docker/dockerfile:1

# ---- build: install everything, compile, then drop the dev dependencies -----------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
# better-sqlite3 ships prebuilt binaries for Linux, but it also has a binding.gyp, so npm would
# try to compile it with node-gyp, which needs Python and a C++ toolchain this slim image
# does not have. Skipping install scripts uses the bundled binary (the CI smoke test checks it).
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

# ---- runtime: only what the bot needs to run ----------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# package.json is required at runtime: its "type": "module" makes dist/*.js load as ESM.
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# The interpreter reads these at startup (see src/nlu/load.ts).
COPY fixtures/catalogo-areas.json fixtures/catalogo-distritos-niveles.json ./fixtures/
COPY data/sinonimos.json ./data/sinonimos.json

# The database lives outside /app/data so mounting a volume there cannot hide sinonimos.json.
ENV DB_PATH=/var/lib/alertas/alertas.sqlite
RUN mkdir -p /var/lib/alertas && chown node:node /var/lib/alertas
VOLUME /var/lib/alertas

USER node
# `node` directly (not `npm start`) so SIGTERM reaches the process and it shuts down cleanly.
CMD ["node", "dist/index.js"]
