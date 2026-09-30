# Sandbox reset wipes local branch/commits/browser cache
_reported by B, 2026-09-30T14:24:28Z_

- **Symptom**: HEAD back to 8dae1b0 on genspark_ai_developer, untracked files gone, pm2 autosave gone, ~/.cache/ms-playwright gone
- **Cause**: sandbox was re-provisioned from the repo (only the remote survives)
- **Fix / workaround**: git fetch && git checkout -B agent/<X> origin/agent/<X>; echo X > .agent-id; tools/autosave/ensure.sh X; tools/hub/hub.sh init; reinstall playwright browser+deps. autosave (3min) saved everything up to the last tick.
