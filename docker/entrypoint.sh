#!/usr/bin/env bash
set -e

# Aether Desktop Container Entrypoint
# Starts Xvfb, dbus, XFCE4, and x11vnc, then execs the CMD.

cleanup() {
    echo "[entrypoint] Received signal, shutting down..."
    # Kill child processes
    kill $(jobs -p) 2>/dev/null || true
    wait
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# --- Start Xvfb ---
echo "[entrypoint] Starting Xvfb on display ${DISPLAY:-:99}..."
Xvfb ${DISPLAY:-:99} -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!
sleep 1

# Verify Xvfb is running
if ! kill -0 $XVFB_PID 2>/dev/null; then
    echo "[entrypoint] ERROR: Xvfb failed to start"
    exit 1
fi

# --- Start dbus session ---
echo "[entrypoint] Starting dbus session..."
eval $(dbus-launch --sh-syntax) 2>/dev/null || true

# --- Start XFCE4 session ---
echo "[entrypoint] Starting XFCE4 session..."
startxfce4 &
XFCE_PID=$!
sleep 2

# --- Start x11vnc ---
echo "[entrypoint] Starting x11vnc on display ${DISPLAY:-:99}, port 5999..."
x11vnc -display ${DISPLAY:-:99} -rfbport 5999 -nopw -forever -shared -xkb -ncache 10 &
X11VNC_PID=$!

echo "[entrypoint] Desktop environment ready."
echo "[entrypoint]   Xvfb PID: $XVFB_PID"
echo "[entrypoint]   XFCE PID: $XFCE_PID"
echo "[entrypoint]   x11vnc PID: $X11VNC_PID"

# If a CMD was passed (e.g. "tail -f /dev/null"), exec it.
# Otherwise wait on background processes.
if [ $# -gt 0 ]; then
    exec "$@"
else
    wait
fi
