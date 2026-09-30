#!/usr/bin/env bash
# Lane B: recover after a sandbox reset (only the remote survives). Idempotent.
cd "$(dirname "$0")/../.." || exit 1
git fetch -q origin
[ "$(git branch --show-current)" = agent/B ] || { git checkout -q -- . 2>/dev/null; git checkout -q -B agent/B origin/agent/B; }
echo B > .agent-id
tools/autosave/ensure.sh B
AGENT_ID=B tools/hub/hub.sh init >/dev/null
[ -d ~/.cache/ms-playwright ] || { npx playwright install chromium-headless-shell >/dev/null 2>&1; sudo npx playwright install-deps chromium >/dev/null 2>&1; }
curl -s -o /dev/null -m 2 http://localhost:5173/ || pm2 start node_modules/vite/bin/vite.js --name vite-b -- --host 0.0.0.0 --port 5173 --config tools/b/vite.b.config.js >/dev/null
echo "restored: $(git log --oneline -1)"
