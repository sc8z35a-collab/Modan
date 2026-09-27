#!/usr/bin/env bash
# Periodic WIP auto-commit (protects work in ephemeral sandboxes). Usage: tools/autosave.sh [intervalSec]
cd "$(dirname "$0")/.." || exit 1
INT=${1:-120}
while true; do
  sleep "$INT"
  if [ -n "$(git status --porcelain -- src tools index.html public/*.webmanifest vite.config.js package.json 2>/dev/null)" ]; then
    # public/ holds ~20MB of binary assets: only stage what the status check looked at
    git add -A -- src tools index.html public/*.webmanifest vite.config.js package.json 2>/dev/null
    git commit -qm "wip: autosave $(date -u +%H:%M:%S)" && echo "autosaved $(date -u +%T)"
  fi
done
