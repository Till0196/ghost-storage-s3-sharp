FROM ghost:6-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json ./
RUN NODE_ENV=development npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ghost:6-alpine
COPY --from=builder /build/package.json /var/lib/ghost/node_modules/ghost-storage-s3-sharp/package.json
COPY --from=builder /build/dist /var/lib/ghost/node_modules/ghost-storage-s3-sharp/dist
USER root
RUN cd /var/lib/ghost/node_modules/ghost-storage-s3-sharp && \
    npm install --omit=dev && \
    rm -rf /root/.npm
