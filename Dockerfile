# ------------------------------------------------------------------------------
# 1. Base stage: shared OS dependencies & working directory
# ------------------------------------------------------------------------------
FROM node:24.21.0-bookworm-slim AS base

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ------------------------------------------------------------------------------
# 2. Build stage: compile TypeScript & generate Prisma client
# ------------------------------------------------------------------------------
FROM base AS build

RUN npm install --global npm@11.19.0

# Dependencies layer (cached unless package*.json changes)
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Source code & Prisma schema (tsconfig.json is required by Prisma for NodeNext .js imports)
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run db:generate && npm run build

# ------------------------------------------------------------------------------
# 3. Production runtime stage
# ------------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# Prisma CLI and tsx remain available for the pre-deploy migration command.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node openapi ./openapi
COPY --chown=node:node certs ./certs
COPY --chown=node:node assets ./assets
COPY --chown=node:node scripts/performance-db-probe.mjs ./scripts/performance-db-probe.mjs
COPY --chown=node:node scripts/render-start.sh ./scripts/render-start.sh
COPY --chown=node:node scripts/render-copy-media.mjs ./scripts/render-copy-media.mjs

USER node
CMD ["node", "--enable-source-maps", "--import", "./dist/instrumentation.js", "dist/server.js"]
