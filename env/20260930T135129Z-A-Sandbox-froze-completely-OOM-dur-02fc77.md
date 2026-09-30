# Sandbox froze completely (OOM) during headless screenshot
_reported by A, 2026-09-30T13:51:29Z_

- **Symptom**: every command incl. 'uptime' timed out; had to call ResetSandbox (all processes killed, disk kept)
- **Cause**: SwiftShader Chromium (500MB+) + vite preview + a second chromium / build on a 985MB VM with 127MB swap
- **Fix / workaround**: use tools/safeshot.sh <name> --hours=.. --pos=.. : global flock (1 chromium for ALL agents), refuses if MemAvailable<450MB, RSS watchdog kills chromium >620MB, 640x288. After a reset: tools/autosave/ensure.sh <X> and pm2 start preview again (reset kills pm2 daemons). autosave had pushed everything before the freeze -> nothing lost.
