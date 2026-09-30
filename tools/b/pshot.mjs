// usage: node tools/b/pshot.mjs out.png "cam=..&look=..&rel=1&night=1"   (vite dev on :5173)
import { chromium } from 'playwright';
const [out, qs = ''] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 900, height: 500 } });
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
await p.goto(`http://localhost:5173/tools/b/propview.html?${qs}`, { timeout: 120000 });
await p.waitForFunction(() => document.title === 'READY' || document.title === 'ERR', null, { timeout: 300000 }).catch(() => logs.push('TIMEOUT'));
await p.screenshot({ path: out, timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.__info)), logs.filter((l) => !/vite|DevTools/.test(l)).slice(0, 15).join('\n'));
await b.close();
