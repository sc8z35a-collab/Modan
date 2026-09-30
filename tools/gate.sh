#!/usr/bin/env bash
# Pre-push gate: build must succeed (exit code, not grep), no merge markers, unit tests pass.
# usage: tools/gate.sh && git push ...
cd "$(dirname "$0")/.." || exit 1
if grep -rn '^<<<<<<<\|^>>>>>>>' src index.html tools --include=*.js --include=*.mjs --include=*.html --include=*.css 2>/dev/null; then echo "GATE FAIL: merge markers"; exit 1; fi
out=$(npx vite build 2>&1); rc=$?
if [ $rc -ne 0 ]; then echo "$out" | grep -A6 "error" | head -20; echo "GATE FAIL: build (rc=$rc)"; exit 1; fi
for t in tools/a/lens.test.mjs tools/d/*.test.mjs; do [ -f "$t" ] || continue; node "$t" >/tmp/gate.$$ 2>&1 || { tail -5 /tmp/gate.$$; echo "GATE FAIL: $t"; exit 1; }; done
echo "GATE OK ($(echo "$out" | grep -o 'built in [0-9.]*s'))"
