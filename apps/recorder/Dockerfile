# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/recorder/Dockerfile .

# Keep in sync with the `playwright` version in apps/recorder/package.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# chrome (Google Chrome, amd64 only) or chromium (bundled with the image).
ARG BROWSER_CHANNEL=chrome
# UID/GID of the host user that owns the bind-mounted folders.
ARG PUID=1000
ARG PGID=1000

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

# Give the image's pwuser the host user's IDs so bind mounts are writable.
# Ubuntu images ship an "ubuntu" user on 1000; remove it first.
RUN (userdel -r ubuntu 2>/dev/null || true) \
 && groupmod -o -g "$PGID" pwuser \
 && usermod -o -u "$PUID" -g "$PGID" pwuser \
 && chown -R pwuser:pwuser /home/pwuser

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
COPY apps/recorder/docker/pulse/recorder.pa /etc/pulse/recorder.pa
COPY apps/recorder/docker/pulse/client.conf /etc/pulse/client.conf.d/00-no-autospawn.conf

# Xvfb needs a root-owned, world-writable socket dir; it can't create one as pwuser.
RUN mkdir -p /config /recordings /tmp/.X11-unix \
 && chown pwuser:pwuser /config /recordings \
 && chmod 1777 /tmp/.X11-unix
USER pwuser
ENV HOME=/home/pwuser \
    XDG_RUNTIME_DIR=/tmp/runtime-pwuser \
    DISPLAY=:99 \
    RECORDINGS_DIR=/recordings \
    PROFILE_DIR=/config/profile

# noVNC (published on 127.0.0.1 only; see compose.yaml)
EXPOSE 6080

# Run from the package so its dependencies (tsx, playwright) resolve; pnpm doesn't hoist.
WORKDIR /app/apps/recorder
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# Bot, browser and capture in one process. `src/smoke.ts` (browser only) is still there
# for logging in: docker compose run --rm --service-ports recorder node --import tsx src/smoke.ts
CMD ["node", "--import", "tsx", "src/main.ts"]
