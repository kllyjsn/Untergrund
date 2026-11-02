# UNTERGRUND Club room service (rooms-server.mjs). No npm dependencies are needed at runtime.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json rooms-server.mjs ./
COPY api/_lib ./api/_lib
COPY js ./js
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "rooms-server.mjs"]
