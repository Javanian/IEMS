FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY apps/portfolio-api/package*.json apps/portfolio-api/
RUN npm ci --prefix apps/portfolio-api --omit=dev --ignore-scripts --no-audit --no-fund
COPY ops/platform/package*.json ops/platform/
RUN npm ci --prefix ops/platform --omit=dev --ignore-scripts --no-audit --no-fund
COPY apps/portfolio-api/src apps/portfolio-api/src
COPY packages packages
COPY ops/platform ops/platform
USER node
EXPOSE 4313
CMD ["node", "ops/platform/local-server.mjs"]
