// Builds the production site into ./site for GitHub Pages (which serves this repository's root as-is).
// Large textures/models are NOT copied: the build loads them from ../public/assets/ (same repo, same origin).
// usage: node tools/build-pages.mjs   (then commit site/ on the published branch)
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('site');
fs.rmSync(OUT, { recursive: true, force: true });
execSync('npx vite build --outDir site --emptyOutDir', { stdio: 'inherit', env: { ...process.env, VITE_ASSET_BASE: '../public/' } });
for (const d of ['assets/textures', 'assets/models', 'assets/CREDITS.md']) fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (html.includes('pages-redirect')) throw new Error('redirect block leaked into the built index.html');
console.log('site/ ready:', execSync('du -sh site').toString().split('\t')[0]);
