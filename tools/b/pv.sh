#!/usr/bin/env bash
# Lane B prop-viewer shots, memory safe: shares A's global chromium mutex (/tmp/modan-chrome.lock); starts the
# lane-B dev server on :5173 (pm2 vite-b) if needed.
# usage: tools/b/pv.sh <job> <name1> "<query1>" [<name2> "<query2>" ...]   then: tools/bg.sh wait <job>
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT" || exit 1
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
[ "$avail" -lt 400 ] && { echo "refusing: ${avail}MB available"; exit 2; }
curl -s -o /dev/null -m 3 http://localhost:5173/tools/b/propview.html || { pm2 start node_modules/vite/bin/vite.js --name vite-b -- --host 0.0.0.0 --port 5173 --config tools/b/vite.b.config.js >/dev/null; sleep 5; }
job="$1"; shift; args=""
while [ $# -ge 2 ]; do args="$args .agents/shots/$1.png '$2'"; shift 2; done
exec tools/bg.sh "$job" "flock -w 600 /tmp/modan-chrome.lock timeout 900 node tools/b/pshot.mjs $args"
