FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts/copy-web-assets.js scripts/write-build-info.cjs ./scripts/
ARG MONEYMONEY_BUILD_ID
RUN test -n "$MONEYMONEY_BUILD_ID" && MONEYMONEY_BUILD_ID="$MONEYMONEY_BUILD_ID" npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
ENV NODE_ENV=production APP_HOST=127.0.0.1 APP_PORT=3000 MONEYMONEY_DATA_DIR=/app/data
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT || 3000)+'/api/health/live',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/web/server.js"]
