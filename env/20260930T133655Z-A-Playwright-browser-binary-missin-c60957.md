# Playwright browser binary missing after npm ci
_reported by A, 2026-09-30T13:36:55Z_

- **Symptom**: node tools/shot.mjs -> 'Executable doesn't exist at ~/.cache/ms-playwright/chromium_headless_shell-XXXX'
- **Cause**: npm package playwright is installed but browser binaries live in ~/.cache (not in node_modules); sandbox reset / fresh clone wipes them
- **Fix / workaround**: npx playwright install chromium (114MB, ~15s). Do NOT use --with-deps (needs apt/root).
