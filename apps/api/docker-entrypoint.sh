#!/bin/sh
set -e

mkdir -p \
  /app/uploads/sow-pdf \
  /app/uploads/ms-project-mpp \
  /app/uploads/operation-card \
  /app/uploads/progress \
  /app/uploads/consumable
chown -R node:node /app/uploads
chmod -R u+rwX,g+rwX /app/uploads

exec su-exec node "$@"
