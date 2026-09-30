#!/usr/bin/env bash
# Shows whether the autosave daemon is alive (heartbeat age) and the last log lines.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT" || exit 1
now=$(date -u +%s); beat=$(cat .agents/autosave.heartbeat 2>/dev/null || echo 0)
age=$((now - beat)); echo "heartbeat age: ${age}s (should be < ~200s)"
pm2 ls 2>/dev/null | grep -E "autosave|name" || pgrep -af autosave.sh
tail -n "${1:-8}" .agents/autosave.log 2>/dev/null
[ "$age" -gt 400 ] && { echo "!! autosave looks dead -> run tools/autosave/ensure.sh"; exit 1; }
exit 0
