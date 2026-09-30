# Playwright browser missing on fresh sandbox
_reported by B, 2026-09-30T13:27:58Z_

- **Symptom**: tools/shot.mjs: Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-1243
- **Cause**: browser binaries are not in the repo/cache on a new sandbox
- **Fix / workaround**: npx playwright install chromium-headless-shell (~7s)
