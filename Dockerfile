# AI MikroTik Assistant — Docker image
# Node 22 (built-in node:sqlite) + express (pure JS, no native deps) -> alpine is sufficient & small.
FROM node:22-alpine

# Retry/timeout tuning: helps on flaky DNS or slow registry links.
ENV NODE_ENV=production \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_TIMEOUT=120000 \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false

WORKDIR /app

# Dependencies first (leverages layer cache).
# Install as root: avoids npm cache permission edge cases; runtime still switches to non-root below.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# App source. Excludes node_modules/data/logs via .dockerignore.
COPY --chown=node:node . .

# Runtime state dirs. Named volumes mounted at runtime are auto-owned by uid 1000.
RUN mkdir -p data logs && chown -R node:node data logs

USER node
EXPOSE 3000
CMD ["node", "server.js"]
