#!/usr/bin/env bash
# Lane D headless test suite (no GPU; safe in the 1GB sandbox). Node tests always run; the browser tests
# (field guide DOM, WebAudio engine) run when a vite dev server is up on :5173.
cd "$(dirname "$0")/../.." || exit 1
rc=0
for t in particles sky fire; do echo "== $t"; timeout 60 node tools/d/$t.test.mjs || rc=1; done
if curl -s -m 3 -o /dev/null http://localhost:5173/; then
  for t in fg-unit audio-unit; do echo "== $t"; timeout 80 node tools/d/unit.mjs http://localhost:5173/tools/d/$t.html || rc=1; done
else echo "(skip browser tests: start 'npx vite --port 5173')"; fi
echo "lane D tests rc=$rc"; exit $rc
