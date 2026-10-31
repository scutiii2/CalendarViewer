# syntax=docker/dockerfile:1
FROM node:22-alpine
ENV NODE_ENV=production CALENDAR_DATA_DIR=/data CALENDAR_BIND=0.0.0.0 PORT=3000
WORKDIR /app

COPY VERSION ./
COPY src ./src
COPY vendor ./vendor
# The named volume copies this folder's owner on first use, so the unprivileged user can write feeds and alert state.
RUN mkdir /data && chown node:node /data
USER node

EXPOSE 3000
CMD ["node", "src/server/server.js"]
