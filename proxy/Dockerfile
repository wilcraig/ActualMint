FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY src ./src

# Bundle build output is volume-mounted at /app/static at deploy time; not baked into the image.
ENTRYPOINT ["node", "src/server.js"]
