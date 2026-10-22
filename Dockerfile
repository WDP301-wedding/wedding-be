FROM node:24.21.0-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global npm@11.19.0
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run db:generate && npm run build

FROM node:24.21.0-bookworm-slim AS runtime

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
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
