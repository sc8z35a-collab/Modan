#!/usr/bin/env bash
# Lane B prop-viewer shot, memory safe: shares A's global chromium mutex (/tmp/modan-chrome.lock), needs the
# lane-B dev server on :5173 (pm2 name vite-b). usage: tools/b/pv.sh <name> "<query>"   then tools/bg.sh wait <name>
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT" || exit 1
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$avail" -lt 400 ] && { echo "refusing: ${avail}MB available"; exit 2; }
curl -s -o /dev/null -m 3 http://localhost:5173/tools/b/propview.html || pm2 start "npx vite --host 0.0.0.0 --port 5173 --config tools/b/vite.b.config.js" --name vite-b >/dev/null && sleep 4
exec tools/bg.sh "$1" "flock -w 600 /tmp/modan-chrome.lock timeout 400 node tools/b/pshot.mjs .agents/shots/$1.png '$2'"
