# AI MikroTik Assistant — Docker image
# Node 22 (built-in node:sqlite) + express (pure JS, no native deps) -> alpine is sufficient & small.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first (leverages layer cache). node:22-alpine ships a non-root `node` user (uid 1000).
COPY --chown=node:node package.json package-lock.json* ./
USER node
RUN npm ci --omit=dev

# App source. Excludes node_modules/data/logs via .dockerignore.
COPY --chown=node:node . .

# Runtime state dirs. Named volumes mounted at runtime are auto-owned by uid 1000.
RUN mkdir -p data logs && chown -R node:node data logs

USER node
EXPOSE 3000
CMD ["node", "server.js"]
