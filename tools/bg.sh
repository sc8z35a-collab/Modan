#!/usr/bin/env bash
# Run a long command fully detached from the calling shell (the agent Bash tool kills its process group on
# return / timeout, so plain `cmd &` jobs die). Output -> .agents/bg/<name>.log, exit code -> <name>.rc
# usage: tools/bg.sh <name> <command...>      then: tools/bg.sh wait <name> [timeoutSec]
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; mkdir -p "$ROOT/.agents/bg"
if [ "$1" = wait ]; then n="$2"; t="${3:-110}"; for ((i=0;i<t;i++)); do [ -f "$ROOT/.agents/bg/$n.rc" ] && { tail -n 30 "$ROOT/.agents/bg/$n.log"; echo "rc=$(cat "$ROOT/.agents/bg/$n.rc")"; exit 0; }; sleep 1; done; echo "(still running) $(tail -n 3 "$ROOT/.agents/bg/$n.log")"; exit 1; fi
n="$1"; shift; rm -f "$ROOT/.agents/bg/$n.rc"
cd "$ROOT" && setsid nohup bash -c "$*; echo \$? > '$ROOT/.agents/bg/$n.rc'" > "$ROOT/.agents/bg/$n.log" 2>&1 < /dev/null &
echo "started $n (pid $!)"
