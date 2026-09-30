#!/usr/bin/env bash
# ================================================================================================
# Collaboration hub for agents A/B/C/D — shared files on the REMOTE repo (orphan branch `collab`).
# Checked out as a git worktree in ./.hub (gitignored). Conflict-free by construction:
#   BOARD.md            leader (A) only: assignments, file ownership, rules, integration state
#   PERMISSIONS.md      leader only: what tools/harnesses/means are explicitly allowed
#   status/<X>.md       agent X only: current state, claimed tasks, ETA
#   msg/<ts>-<from>-to-<to>.md   one file per message (never edited, never conflicts)
#   tips/<ts>-<X>.md    one file per craft tip ("how to make details look good")
#   env/<ts>-<X>.md     one file per DEV-ENVIRONMENT trouble: symptom / cause / fix
#   done/<task>-<X>.md  completion report per task
# Commands (AGENT_ID env or .agent-id selects who you are):
#   hub.sh init                 create/attach worktree (+ create remote branch if missing)
#   hub.sh sync                 pull --rebase + commit + push (retries). autosave calls it every 3 min
#   hub.sh post <to|all> "msg"  send a message           hub.sh inbox      unread messages for me
#   hub.sh tip "title" "body"   share a craft tip        hub.sh env "title" "symptom" "cause" "fix"
#   hub.sh status "text"        overwrite my status      hub.sh done <task> "report"
#   hub.sh board | tips | envs | all-status | digest (everything, for a fresh agent)
# ================================================================================================
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HUB="$ROOT/.hub"; BR=collab
ME="${AGENT_ID:-$(cat "$ROOT/.agent-id" 2>/dev/null || echo A)}"
LOCK="$ROOT/tools/.git-lock"; touch "$LOCK"
ts() { date -u +%Y%m%dT%H%M%SZ; }
now() { date -u +%FT%TZ; }
slug() { echo "$1" | tr -c 'A-Za-z0-9_-' '-' | cut -c1-40; }

locked() { if [ "${HUB_NOLOCK:-0}" = 1 ]; then "$@"; else ( flock -w 120 9 || exit 1; "$@" ) 9>"$LOCK"; fi; }

do_init() {
  cd "$ROOT" || exit 1
  if [ -d "$HUB/.git" ] || [ -f "$HUB/.git" ]; then return 0; fi
  git fetch -q origin "$BR" 2>/dev/null
  if git rev-parse -q --verify "origin/$BR" >/dev/null; then
    git worktree add -q -B "$BR" "$HUB" "origin/$BR" 2>/dev/null || git worktree add -q "$HUB" "$BR"
  else
    git worktree add -q --detach "$HUB" && (cd "$HUB" && git checkout -q --orphan "$BR" && git rm -rqf . 2>/dev/null; mkdir -p status msg tips env done
      echo "# hub" > README.md; git add -A; git commit -qm "hub: init"; git push -q -u origin "$BR")
  fi
  (cd "$HUB" && git branch -q --set-upstream-to="origin/$BR" "$BR" 2>/dev/null; mkdir -p status msg tips env done)
}

do_sync() {
  do_init; cd "$HUB" || return 1
  git add -A
  git diff --cached --quiet || git commit -qm "hub($ME): $(now)"
  for i in 1 2 3 4; do
    timeout 60 git pull -q --rebase origin "$BR" 2>/dev/null || { git rebase --abort 2>/dev/null; git pull -q --no-rebase -X ours origin "$BR" 2>/dev/null; }
    timeout 60 git push -q origin "HEAD:$BR" 2>/dev/null && { echo "hub synced ($ME) $(now)"; return 0; }
    sleep $((i * 3))
  done
  echo "hub sync FAILED ($ME)"; return 1
}

write() { do_init; mkdir -p "$(dirname "$HUB/$1")"; cat > "$HUB/$1"; locked do_sync; }

cmd="${1:-help}"; shift || true
case "$cmd" in
  init) locked do_init && echo "hub worktree: $HUB" ;;
  sync) if [ "${HUB_NOLOCK:-0}" = 1 ]; then do_sync; else locked do_sync; fi ;;
  post) to="$1"; shift; printf -- "---\nfrom: %s\nto: %s\ntime: %s\n---\n%s\n" "$ME" "$to" "$(now)" "$*" | write "msg/$(ts)-$ME-to-$to.md" ;;
  tip) t="$1"; shift; printf -- "# %s\n_by %s, %s_\n\n%s\n" "$t" "$ME" "$(now)" "$*" | write "tips/$(ts)-$ME-$(slug "$t").md" ;;
  env) printf -- "# %s\n_reported by %s, %s_\n\n- **Symptom**: %s\n- **Cause**: %s\n- **Fix / workaround**: %s\n" "$1" "$ME" "$(now)" "${2:-}" "${3:-}" "${4:-}" | write "env/$(ts)-$ME-$(slug "$1").md" ;;
  status) printf -- "# Agent %s status\n_updated %s_\n\n%s\n" "$ME" "$(now)" "$*" | write "status/$ME.md" ;;
  done) t="$1"; shift; printf -- "# DONE %s by %s\n_%s_\n\n%s\n" "$t" "$ME" "$(now)" "$*" | write "done/$t-$ME.md" ;;
  inbox)
    locked do_sync >/dev/null; mark="$ROOT/.agents/.inbox-$ME"; last="$(cat "$mark" 2>/dev/null || echo 0)"
    for f in $(ls "$HUB/msg" 2>/dev/null | sort); do
      case "$f" in *-to-"$ME".md|*-to-all.md) [[ "$f" > "$last" ]] && { echo "=== $f"; sed 1,5d "$HUB/msg/$f"; } ;; esac
    done
    ls "$HUB/msg" 2>/dev/null | sort | tail -1 > "$mark" ;;
  board) locked do_sync >/dev/null; cat "$HUB/BOARD.md" ;;
  tips) for f in "$HUB"/tips/*.md; do [ -f "$f" ] && { cat "$f"; echo; }; done ;;
  envs) for f in "$HUB"/env/*.md; do [ -f "$f" ] && { cat "$f"; echo; }; done ;;
  all-status) for f in "$HUB"/status/*.md "$HUB"/done/*.md; do [ -f "$f" ] && { cat "$f"; echo; }; done ;;
  digest) locked do_sync >/dev/null; for f in BOARD.md PERMISSIONS.md; do cat "$HUB/$f" 2>/dev/null; echo; done; "$0" all-status; "$0" tips; "$0" envs ;;
  *) sed -n 2,20p "$0" ;;
esac
