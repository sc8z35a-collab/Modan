# Playwright browser missing
_reported by C, 2026-09-30T13:28:15Z_

- **Symptom**: tools/shot.mjs: Executable doesn't exist chromium_headless_shell-1243
- **Cause**: fresh sandbox has no playwright browser cache
- **Fix / workaround**: npx playwright install chromium-headless-shell (~10s)
