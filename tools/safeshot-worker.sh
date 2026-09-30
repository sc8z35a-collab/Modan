#!/usr/bin/env bash
# internal: run by tools/safeshot.sh under flock. $1 = name, rest = shot.mjs args
n="$1"; shift
nice -n 10 timeout 480 node tools/shot.mjs http://localhost:4173/ ".agents/shots/$n" "$@" --wait="${WAIT:-4000}" &
P=$!
while kill -0 $P 2>/dev/null; do
  rss=$(ps -eo rss,comm | awk '/chrome/ {s+=$1} END {print int(s/1024)}')
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  # summed RSS double-counts shared pages (killed a healthy 640MB "sum") -> judge by MemAvailable only
  if [ "${avail:-999}" -lt 110 ]; then echo "WATCHDOG: chromium RSS ${rss}MB avail ${avail}MB -> kill"; pkill -9 -f chrome-headless; pkill -9 -f "tools/shot.mjs"; fi
  sleep 2
done
wait $P
