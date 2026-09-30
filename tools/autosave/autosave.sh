#!/usr/bin/env bash
# ------------------------------------------------------------------------------------------------
# Autosave daemon: every $AUTOSAVE_INTERVAL seconds (default 180 = 3 min)
#   1. commits every change in the working tree (respecting .gitignore) as "wip(autosave)"
#   2. pushes the current branch to origin (so the open PR is updated automatically)
#   3. creates a draft PR for the branch if none exists yet (once)
#   4. syncs the collaboration hub (tools/hub/hub.sh sync) so agent messages are never lost
# Safe by design:
#   - all git mutations take tools/.git-lock via flock (hub + autosave + manual scripts never race)
#   - skips while a merge / rebase / cherry-pick is in progress
#   - refuses to stage single files > 50MB (GitHub hard limit is 100MB)
#   - non-fast-forward push -> pull --rebase --autostash then push again (other agent pushed)
#   - writes a heartbeat so `tools/autosave/status.sh` can tell if it is alive
# Run it through tools/autosave/ensure.sh (pm2 managed, auto-restart) — do not start it by hand twice.
# ------------------------------------------------------------------------------------------------
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 1
INTERVAL="${AUTOSAVE_INTERVAL:-180}"
AGENT="${AGENT_ID:-$(cat "$ROOT/.agent-id" 2>/dev/null || echo A)}"
LOG="$ROOT/.agents/autosave.log"
BEAT="$ROOT/.agents/autosave.heartbeat"
LOCK="$ROOT/tools/.git-lock"
mkdir -p "$ROOT/.agents"
touch "$LOCK"
log() { echo "[$(date -u +%FT%TZ)] [$AGENT] $*" | tee -a "$LOG"; }

busy_git() { [ -f .git/MERGE_HEAD ] || [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ] || [ -f .git/CHERRY_PICK_HEAD ]; }

save_once() {
  local br; br="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ -z "$br" ] || [ "$br" = "HEAD" ]; then log "detached HEAD -> skip"; return; fi
  if busy_git; then log "merge/rebase in progress -> skip"; return; fi
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    git add -A 2>/dev/null
    # guard: unstage huge files
    git diff --cached --name-only -z | while IFS= read -r -d '' f; do
      if [ -f "$f" ] && [ "$(stat -c %s "$f")" -gt 52428800 ]; then git reset -q -- "$f"; log "skip huge file $f"; fi
    done
    if ! git diff --cached --quiet; then
      local n; n="$(git diff --cached --name-only | wc -l)"
      git commit -qm "wip(autosave): agent $AGENT $(date -u +%H:%M:%S) — $n file(s)" && log "committed $n file(s) on $br"
    fi
  fi
  # push if ahead of remote (or remote branch does not exist yet)
  local ahead=1
  if git rev-parse --verify -q "origin/$br" >/dev/null; then ahead="$(git rev-list --count "origin/$br..HEAD")"; fi
  if [ "$ahead" != "0" ]; then
    if ! timeout 90 git push -q origin "HEAD:refs/heads/$br" 2>>"$LOG"; then
      log "push rejected -> pull --rebase"
      timeout 90 git pull -q --rebase --autostash origin "$br" 2>>"$LOG" || { git rebase --abort 2>/dev/null; log "rebase failed (conflict) -> manual fix needed"; return; }
      timeout 90 git push -q origin "HEAD:refs/heads/$br" 2>>"$LOG" && log "pushed after rebase" || log "push failed again"
    else log "pushed $br (+$ahead)"; fi
    git fetch -q origin "$br" 2>/dev/null
  fi
  # ensure a PR exists for work branches (never for the default/integration branch itself)
  if command -v gh >/dev/null && [ "$br" != "genspark_ai_developer" ] && [ "$br" != "collab" ] && [ ! -f ".agents/.pr-$br" ]; then
    local base="genspark_ai_developer"; case "$br" in agent/*) base="feat/detail-upgrade";; esac
    if gh pr view "$br" --json number >/dev/null 2>&1; then touch ".agents/.pr-$br"
    elif timeout 60 gh pr create --draft --base "$base" --head "$br" --title "[WIP] $br (autosaved by agent $AGENT)" --body "Auto-created by tools/autosave. Work in progress; squashed before merge." >>"$LOG" 2>&1; then touch ".agents/.pr-$br"; log "draft PR created for $br -> $base"; fi
  fi
}

log "autosave daemon start: interval=${INTERVAL}s root=$ROOT"
while true; do
  (
    flock -w 120 9 || { log "lock timeout"; exit 0; }
    save_once
    [ -x "$ROOT/tools/hub/hub.sh" ] && AGENT_ID="$AGENT" HUB_NOLOCK=1 "$ROOT/tools/hub/hub.sh" sync >>"$LOG" 2>&1
  ) 9>"$LOCK"
  date -u +%s > "$BEAT"
  sleep "$INTERVAL"
done
