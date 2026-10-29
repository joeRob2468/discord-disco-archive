# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/archive/Dockerfile .

# Stage 1: build the stylesheet and the client scripts (Tailwind, daisyUI and esbuild
# are dev dependencies).
FROM node:24-bookworm-slim AS assets
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/archive/package.json apps/archive/
RUN pnpm install --frozen-lockfile --filter @dsr/archive...
COPY tsconfig.base.json ./
COPY apps/archive/src apps/archive/src
RUN pnpm --filter @dsr/archive build:css && pnpm --filter @dsr/archive build:js

FROM node:24-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/archive/package.json apps/archive/
RUN pnpm install --frozen-lockfile --prod --filter @dsr/archive...

COPY packages/core/src packages/core/src
COPY apps/archive/src apps/archive/src
# Icons, the link preview image and the font (copied into the checkout by hand).
COPY apps/archive/public apps/archive/public
# tsx needs the archive's tsconfig for hono/jsx; it would otherwise compile JSX for React.
COPY tsconfig.base.json ./
COPY apps/archive/tsconfig.json apps/archive/
COPY --from=assets /app/apps/archive/dist apps/archive/dist

RUN mkdir -p /config && chown node:node /config
USER node
ENV RECORDINGS_DIR=/recordings \
    ARCHIVE_DATA_DIR=/config \
    TSX_TSCONFIG_PATH=tsconfig.json
EXPOSE 3000
# Run from the package so its dependencies (tsx) resolve; pnpm doesn't hoist.
WORKDIR /app/apps/archive
CMD ["node", "--import", "tsx", "src/main.ts"]
