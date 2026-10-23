#!/usr/bin/env bash
# Start the virtual display, PulseAudio sinks and (optionally) noVNC, then run the
# recorder. See docs/plan.md, "Container details".
set -euo pipefail

: "${DISPLAY:=:99}"
: "${VIDEO_SIZE:=1920x1080}"
: "${VNC_ENABLED:=true}"
export DISPLAY

log() { echo "[entrypoint] $*" >&2; }

# The container filesystem survives restarts, so clear state from the last run.
rm -f "/tmp/.X${DISPLAY#:}-lock" "/tmp/.X11-unix/X${DISPLAY#:}"
rm -rf "${XDG_RUNTIME_DIR:?}" && mkdir -m 700 -p "$XDG_RUNTIME_DIR"

# Virtual display
# Xvfb's stderr is mostly harmless xkbcomp keysym warnings; the check below catches failures.
Xvfb "$DISPLAY" -screen 0 "${VIDEO_SIZE}x24" -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 50); do xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break; sleep 0.1; done
if ! xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
  log "Xvfb did not start on $DISPLAY"
  exit 1
fi

# PulseAudio with only the null sink/source from /etc/pulse/recorder.pa
# (no dbus or hardware modules; client autospawn is disabled in client.conf.d).
pulseaudio --daemonize=no --exit-idle-time=-1 --realtime=no --high-priority=no \
  --log-target=stderr --log-level=error -n -F /etc/pulse/recorder.pa &
for _ in $(seq 50); do pactl info >/dev/null 2>&1 && break; sleep 0.1; done
if ! pactl list short sinks | grep -q '^[0-9]*\s*recorder\s'; then
  log "PulseAudio did not come up with the 'recorder' sink"
  exit 1
fi
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
