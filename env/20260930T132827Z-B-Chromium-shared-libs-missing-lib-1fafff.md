# Chromium shared libs missing (libatk-1.0.so.0)
_reported by B, 2026-09-30T13:28:27Z_

- **Symptom**: shot.mjs launch fails: error while loading shared libraries: libatk-1.0.so.0
- **Cause**: fresh sandbox lacks chromium system deps
- **Fix / workaround**: sudo npx playwright install-deps chromium (~15s) after npx playwright install chromium-headless-shell
