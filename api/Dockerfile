FROM node:20-alpine

# Needed for TZ env var to affect Node's Date/day-of-month math (musl has no
# bundled zoneinfo).
RUN apk add --no-cache tzdata

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY src ./src

# Long-running service, not a one-shot. Actual connection config comes from env at deploy time.
ENTRYPOINT ["node", "src/server.js"]
