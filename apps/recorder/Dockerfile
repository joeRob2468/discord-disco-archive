# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/recorder/Dockerfile .

# Keep in sync with the `playwright` version in apps/recorder/package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# chrome (Google Chrome, amd64 only) or chromium (bundled with the image).
ARG BROWSER_CHANNEL=chrome

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb x11-utils pulseaudio pulseaudio-utils ffmpeg \
      x11vnc novnc websockify \
 && rm -rf /var/lib/apt/lists/*

RUN if [ "$BROWSER_CHANNEL" = "chrome" ]; then \
      npx -y playwright@1.64.1 install --with-deps chrome; \
    fi

RUN corepack enable

WORKDIR /app

# Install dependencies first so source edits don't invalidate this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/media/package.json packages/media/
COPY apps/recorder/package.json apps/recorder/
RUN pnpm install --frozen-lockfile --prod --filter @dsr/recorder...

COPY packages/core/src packages/core/src
COPY packages/media/src packages/media/src
COPY apps/recorder/src apps/recorder/src
COPY --chmod=755 apps/recorder/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN mkdir -p /config /recordings && chown pwuser:pwuser /config /recordings
USER pwuser
ENV HOME=/home/pwuser \
    DISPLAY=:99 \
    RECORDINGS_DIR=/recordings \
    PROFILE_DIR=/config/profile

# noVNC (published on 127.0.0.1 only; see compose.yaml)
EXPOSE 6080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# Milestone 1: smoke test. Replaced by src/main.ts once the bot and controller exist.
CMD ["node", "--import", "tsx", "apps/recorder/src/smoke.ts"]
