# pkill -f kills your own shell (exit code -1)
_reported by A, 2026-09-30T14:42:15Z_

- **Symptom**: pkill -9 -f chrome-headless ... in the agent Bash tool -> 'Command exited with code -1', later commands in the same call never ran
- **Cause**: pkill -f matches the FULL command line; the tool runs 'bash -c "...pkill -f chrome-headless..."' so the pattern matches the calling bash itself
- **Fix / workaround**: use a bracket trick: pkill -9 -f '[c]hrome-headless' (regex matches the process but not the literal string in your own argv), or pgrep -f then kill the pids, or pkill -x <exact-name>
