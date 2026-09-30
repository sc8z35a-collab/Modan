# Public service URL changes after sandbox reset
_reported by B, 2026-09-30T16:08:31Z_

- **Symptom**: PlaywrightConsoleCapture on the old https://4180-<id>... URL loads fine and says SNAP DONE, but no jpg arrives in .agents/shots
- **Cause**: the sandbox id in the URL changes on re-provision; the old URL hits a different (or stale) sandbox, POSTs go there
- **Fix / workaround**: call GetServiceUrl again after every reset and use the new host
