// Finds code accidentally swallowed by a trailing // comment: a line comment whose text contains statement-like
// code (`this.x = `, `foo(...);`, `const `, `.add(`) — produced by careless one-line edits. Usage: node tools/b/lint-swallowed.mjs [dir]
import fs from 'fs'; import path from 'path';
const root = process.argv[2] || 'src'; let hits = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) check(p); } };
const code = /(\bthis\.[\w.]+\s*=[^=]|\b(const|let|var)\s+\w+\s*=|[\w\]\)]\.(add|set|copy|push|remove)\([^)]*\)\s*;|;\s*\w[\w.]*\([^)]*\)\s*;|\breturn\b.*;$)/;
function check(p) {
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    // strip strings / regex-ish content crudely, find a // that starts a comment after code
    const s = l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
    const k = s.indexOf('//'); if (k < 0) return;
    const before = s.slice(0, k).trim(), after = s.slice(k + 2);
    if (!before) return; // whole-line comments are fine (commented-out code is intentional there)
    if (/https?:$/.test(before)) return;
    if (code.test(after)) { hits++; console.log(`${p}:${i + 1}: ${l.trim().slice(0, 160)}`); }
  });
}
walk(root); console.log(`${hits} suspicious trailing comment(s)`); process.exitCode = hits ? 1 : 0;
