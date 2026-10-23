#!/usr/bin/env bash
# Start the virtual display, PulseAudio sinks and (optionally) noVNC, then run the
# recorder. See docs/plan.md, "Container details".
set -euo pipefail

: "${DISPLAY:=:99}"
: "${VIDEO_SIZE:=1920x1080}"
: "${VNC_ENABLED:=true}"
export DISPLAY

log() { echo "[entrypoint] $*" >&2; }

# Virtual display
rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 "${VIDEO_SIZE}x24" -nolisten tcp &
for _ in $(seq 50); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done

# PulseAudio: a float32 null sink is the browser's only output; its monitor is what
# ffmpeg records. A null source gives Discord a silent mic.
pulseaudio --daemonize=no --exit-idle-time=-1 --log-target=stderr --log-level=error &
for _ in $(seq 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
pactl load-module module-null-sink sink_name=recorder format=float32le rate=48000 channels=2 \
  sink_properties=device.description=recorder >/dev/null
pactl load-module module-null-source source_name=silence >/dev/null
pactl set-default-sink recorder
pactl set-default-source silence
log "display $DISPLAY ready, PulseAudio sink 'recorder' ready"

# noVNC for logging in and debugging. The container port is published on the host's
# loopback only; on a server, reach it through an SSH tunnel.
if [[ "$VNC_ENABLED" == "true" ]]; then
  if [[ -z "${VNC_PASSWORD:-}" ]]; then
    log "VNC_ENABLED=true but VNC_PASSWORD is empty; refusing to start an open VNC server"
    exit 1
  fi
  mkdir -p "$HOME/.vnc"
  x11vnc -storepasswd "$VNC_PASSWORD" "$HOME/.vnc/passwd" >/dev/null
  x11vnc -display "$DISPLAY" -rfbauth "$HOME/.vnc/passwd" -forever -shared -localhost \
    -rfbport 5900 -quiet &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
  log "noVNC on container port 6080"
fi

exec "$@"
