# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/archive/Dockerfile .
FROM node:24-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/archive/package.json apps/archive/
RUN pnpm install --frozen-lockfile --prod --filter @dsr/archive...

COPY packages/core/src packages/core/src
COPY apps/archive/src apps/archive/src
# tsx needs the archive's tsconfig for hono/jsx; it would otherwise compile JSX for React.
COPY tsconfig.base.json ./
COPY apps/archive/tsconfig.json apps/archive/

RUN mkdir -p /config && chown node:node /config
USER node
ENV RECORDINGS_DIR=/recordings \
    ARCHIVE_DATA_DIR=/config \
    TSX_TSCONFIG_PATH=apps/archive/tsconfig.json
EXPOSE 3000
CMD ["node", "--import", "tsx", "apps/archive/src/main.ts"]
