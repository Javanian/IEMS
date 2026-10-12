FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache iputils

COPY package.json package-lock.json ./
RUN npm ci

COPY scripts/ping_m5051_machines.js ./scripts/ping_m5051_machines.js

CMD ["node", "scripts/ping_m5051_machines.js", "--loop", "--interval-ms=60000", "--retention-days=30"]
