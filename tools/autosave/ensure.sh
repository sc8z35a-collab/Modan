#!/usr/bin/env bash
# Idempotent: starts the autosave daemon under pm2 if it is not running (safe to call any time / from npm hooks).
# usage: tools/autosave/ensure.sh [AGENT_ID]      (AGENT_ID also persisted in .agent-id)
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
[ -n "${1:-}" ] && echo "$1" > .agent-id
AGENT="$(cat .agent-id 2>/dev/null || echo A)"
NAME="autosave-$AGENT"
chmod +x tools/autosave/*.sh tools/hub/*.sh 2>/dev/null
if command -v pm2 >/dev/null; then
  if pm2 describe "$NAME" 2>/dev/null | grep -q online; then echo "autosave already running ($NAME)"; exit 0; fi
  pm2 delete "$NAME" >/dev/null 2>&1
  AGENT_ID="$AGENT" pm2 start tools/autosave/autosave.sh --name "$NAME" --interpreter bash --restart-delay 5000 >/dev/null && echo "autosave started under pm2 ($NAME)"
else
  if pgrep -f "tools/autosave/autosave.sh" >/dev/null; then echo "autosave already running"; exit 0; fi
  AGENT_ID="$AGENT" setsid nohup bash tools/autosave/autosave.sh >/dev/null 2>&1 < /dev/null & echo "autosave started (setsid nohup)"
fi
