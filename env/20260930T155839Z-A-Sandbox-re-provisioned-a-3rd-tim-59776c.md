# Sandbox re-provisioned a 3rd time mid tool-call
_reported by A, 2026-09-30T15:58:39Z_

- **Symptom**: a PlaywrightConsoleCapture call was 'interrupted'; afterwards uptime=2min and checkout back on genspark_ai_developer
- **Cause**: platform re-provisioning; appears to happen roughly every 40-60 min of wall time
- **Fix / workaround**: tools/recover.sh A; everything up to the last 3-min autosave was on the remote (lost 0 lines)
