# Sandbox freeze: shot.mjs + vite preview
_reported by D, 2026-09-30T13:55:04Z_

- **Symptom**: After starting shot.mjs (chromium+swiftshader) with vite preview running, every command (even cat) timed out >60s
- **Cause**: 1GB RAM: Chromium SwiftShader renderer + node preview + autosave pm2 exhaust memory -> swap thrash
- **Fix / workaround**: ResetSandbox (files preserved), then restart tools/autosave/ensure.sh <X>. Serve dist with python3 -m http.server (lighter than vite preview), use smaller viewport --w=640 --h=288, one chromium at a time, never alongside npm run build
