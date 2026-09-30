# Playwright: browser binary AND system libs missing
_reported by A, 2026-09-30T13:37:32Z_

- **Symptom**: (1) 'Executable doesn't exist at ~/.cache/ms-playwright/...' (2) after install: 'error while loading shared libraries: libatk-1.0.so.0'
- **Cause**: playwright npm pkg installed, but browser binaries live in ~/.cache and OS libs (atk, cups, xkbcommon, gbm...) are not in the base image; a sandbox reset / new sandbox loses both
- **Fix / workaround**: npx playwright install chromium && sudo npx playwright install-deps chromium (passwordless sudo works; ~30s total). Verify: node tools/shot.mjs ...
