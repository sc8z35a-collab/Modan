#!/usr/bin/env bash
# Lane C: memory-safe nature-viewer screenshot. Shares the global chromium mutex with tools/safeshot.sh.
# usage: tools/c/cshot.sh <name> "<querystring>"   -> .agents/shots/<name>.png ; wait: tools/bg.sh wait <name> 300
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT" || exit 1
n="$1"; qs="$2"
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$avail" -lt 450 ] && { echo "refusing: only ${avail}MB available"; exit 2; }
curl -s -o /dev/null -m 3 http://localhost:5174/ || pm2 start node_modules/vite/bin/vite.js --name vitec -- --port 5174 --config tools/c/vite.c.config.js >/dev/null
exec tools/bg.sh "$n" "flock -w 900 /tmp/modan-chrome.lock nice -n 5 timeout 800 node tools/c/nshot.mjs .agents/shots/$n.png '$qs'"
