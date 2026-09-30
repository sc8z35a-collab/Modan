#!/usr/bin/env bash
# Memory-safe screenshot for the 1GB sandbox (a plain shot.mjs run froze the whole VM once: SwiftShader Chromium
# + vite preview + pm2 ate all RAM and even `uptime` hung -> ResetSandbox was needed).
#   - global mutex (only ONE chromium across all agents / shells): flock on /tmp/modan-chrome.lock
#   - refuses to start when MemAvailable < 450MB
#   - runs niced, inside a cgroup-less RSS watchdog: kills chromium if total RSS > 620MB
#   - small default viewport (640x288) and ?q=qa
#   - fully detached (tools/bg.sh) -> poll with: tools/bg.sh wait <name>
# usage: tools/safeshot.sh <name> [--hours=..] [--pos=x,z,yaw,pitch] [--extra=zoom=20] [--w=640 --h=288]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT" || exit 1
n="$1"; shift
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "$avail" -lt 450 ]; then echo "refusing: only ${avail}MB available (need 450). Stop other chromium / builds first."; exit 2; fi
curl -s -o /dev/null -m 3 http://localhost:4173/ || { echo "preview server not running: pm2 start 'npx vite preview --host 0.0.0.0 --port 4173' --name preview"; exit 3; }
args="$*"; case "$args" in *--w=*) ;; *) args="$args --w=640 --h=288";; esac
exec "$ROOT/tools/bg.sh" "$n" "flock -w 600 /tmp/modan-chrome.lock tools/safeshot-worker.sh $n $args"
