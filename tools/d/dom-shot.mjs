// DOM-only screenshot (GPU disabled -> no SwiftShader; safe in the 1GB sandbox). usage: node tools/d/dom-shot.mjs url out.png [w h]
import { chromium } from 'playwright';
const [url, out, w = 915, h = 412] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--disable-gpu', '--disable-dev-shm-usage', '--renderer-process-limit=1', '--disable-extensions', '--js-flags=--max-old-space-size=256'] });
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, isMobile: true, hasTouch: true })).newPage();
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
console.log(JSON.stringify(await p.evaluate(() => window.__fg ? { toasts: window.__fg.toasts, count: window.__fg.fg.count } : null)));
console.log(logs.join('\n'));
await b.close();
