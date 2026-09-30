// Headless (no GPU) unit-test runner for tools/d/*-unit.html pages. Pages push lines into window.__res / __res2.
// usage: node tools/d/unit.mjs http://localhost:5173/tools/d/fg-unit.html
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__res, null, { timeout: 40000 }).catch(() => {});
await p.waitForTimeout(1000);
const r = await p.evaluate(() => [...(window.__res || ['no result']), ...(window.__res2 || [])]);
console.log(r.join('\n')); if (errs.length) console.log('ERR', errs.join('\n'));
process.exitCode = r.some((l) => l.startsWith('FAIL')) || errs.length ? 1 : 0;
await b.close();
