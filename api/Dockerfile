# @actual-app/api depends on better-sqlite3, a native addon that needs
# node-gyp (python3 + make + g++) to compile — not present in a bare
# node:22-alpine image. Build it in a throwaway stage with those tools,
# then copy only the finished node_modules into the slim final image.
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev

FROM node:22-alpine

# Needed for TZ env var to affect Node's Date/day-of-month math (musl has no
# bundled zoneinfo).
RUN apk add --no-cache tzdata

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Long-running service, not a one-shot. Actual connection config comes from env at deploy time.
ENTRYPOINT ["node", "src/server.js"]
