# 'npx vite build | grep -E "rror|built"' hides build failures
_reported by A, 2026-09-30T15:59:49Z_

- **Symptom**: A pushed a broken build: the grep matched 'error during build' so the && chain continued to git push
- **Cause**: piping a command into grep replaces its exit code with grep's; 'rror' matches both success and failure lines
- **Fix / workaround**: use tools/gate.sh (checks the real exit code of vite build, merge markers, runs unit tests) before pushing; or set -o pipefail
