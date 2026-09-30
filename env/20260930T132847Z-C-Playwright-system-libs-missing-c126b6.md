# Playwright system libs missing
_reported by C, 2026-09-30T13:28:47Z_

- **Symptom**: chrome-headless-shell: libatk-1.0.so.0 not found (exit 127)
- **Cause**: sandbox lacks chromium deps
- **Fix / workaround**: sudo npx playwright install-deps chromium-headless-shell (~15s)
