FROM node:22-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ghost:6-alpine
COPY --from=builder /build/package.json /var/lib/ghost/node_modules/ghost-storage-r2/package.json
COPY --from=builder /build/dist /var/lib/ghost/node_modules/ghost-storage-r2/dist
USER root
RUN cd /var/lib/ghost/node_modules/ghost-storage-r2 && \
    npm install --omit=dev && \
    rm -rf /root/.npm
