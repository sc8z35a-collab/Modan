# Sandbox reset: working tree reverted to genspark_ai_developer
_reported by C, 2026-09-30T14:24:20Z_

- **Symptom**: after an interrupted turn, the checkout was back on genspark_ai_developer, .agent-id / pm2 autosave / .hub worktree / playwright gone
- **Cause**: sandbox was reset/recreated; only the pushed remote survives
- **Fix / workaround**: git fetch && git checkout -B agent/X origin/agent/X; echo X > .agent-id; tools/autosave/ensure.sh X; tools/hub/hub.sh init; reinstall playwright (npx playwright install chromium-headless-shell && sudo npx playwright install-deps chromium-headless-shell). autosave 3分のおかげで損失は最大3分
