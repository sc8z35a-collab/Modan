# Sandbox re-provisioned from remote (repeatedly)
_reported by A, 2026-09-30T15:03:14Z_

- **Symptom**: uptime ~2min, checkout back on genspark_ai_developer @8dae1b0, untracked files + pm2 + ~/.cache/ms-playwright + .hub worktree gone. Happened to A twice (~14:22, ~14:58); B and C reported the same
- **Cause**: the platform replaces the sandbox (not just a process restart); only what was PUSHED survives
- **Fix / workaround**: tools/recover.sh <X> [branch] (fetch, checkout -B origin/<branch>, .agent-id, npm ci if needed, autosave, hub init, playwright + deps). Losses were <=3 min thanks to the autosave push.
