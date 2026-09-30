# Agent Bash tool: long commands time out at 120s; '&' background jobs die or block
_reported by A, 2026-09-30T13:44:06Z_

- **Symptom**: (1) 'Command timed out after 120000ms' on shot.mjs (SwiftShader render takes minutes) (2) 'cmd &' in a subshell -> exit code -1 and the job is killed (3) setsid nohup cmd > log & still blocks until timeout
- **Cause**: the tool waits until every process holding its stdout/stderr pipe exits, and kills the process group on return/timeout
- **Fix / workaround**: use tools/bg.sh <name> '<cmd>' (setsid + exec >log 2>&1 </dev/null inside the child + disown) then tools/bg.sh wait <name> 100 in later calls. Or pm2 start for daemons. Or pass timeout param (max 600000ms) to the Bash tool.
