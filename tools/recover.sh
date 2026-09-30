#!/usr/bin/env bash
# One-shot recovery after a sandbox reset / re-provision (the checkout comes back on genspark_ai_developer,
# untracked files / pm2 daemons / playwright browsers / .hub are gone; only the remote survives).
# usage: tools/recover.sh <AGENT_ID> [branch]      e.g. tools/recover.sh B agent/B
set -u
X="${1:?agent id}"; BR="${2:-$( [ "$X" = A ] && echo feat/detail-upgrade || echo agent/$X )}"
cd "$(dirname "$0")/.." || exit 1
git fetch -q --all
git checkout -q -B "$BR" "origin/$BR" 2>/dev/null || git checkout -q -b "$BR"
echo "$X" > .agent-id
[ -d node_modules/three ] || npm ci --no-audit --no-fund >/dev/null 2>&1
tools/autosave/ensure.sh "$X"
tools/hub/hub.sh init >/dev/null
if [ ! -d ~/.cache/ms-playwright ] || ! ls ~/.cache/ms-playwright | grep -q headless; then
  npx playwright install chromium-headless-shell >/dev/null 2>&1 && sudo npx playwright install-deps chromium-headless-shell >/dev/null 2>&1 && echo "playwright ok"
fi
echo "recovered: agent=$X branch=$BR head=$(git log --oneline -1)"
