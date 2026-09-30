// usage: node tools/a/lshot.mjs out.png "zoom=20&hours=16" [out2.png "qs2" ...]  (serves via vite dev on :5175)
import { chromium } from 'playwright';
const a = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--renderer-process-limit=1'] });
for (let i = 0; i < a.length; i += 2) {
  const [out, qs = ''] = [a[i], a[i + 1]];
  const sp = new URLSearchParams(qs); const w = +(sp.get('w') || 640), h = +(sp.get('h') || 288);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  const t = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 5175}/tools/a/lensview.html?${qs}`, { timeout: 120000 });
  await p.waitForFunction(() => document.title === 'READY' || document.title === 'ERR', null, { timeout: 400000 }).catch(() => logs.push('TIMEOUT'));
  await p.screenshot({ path: out, timeout: 200000 });
  console.log(out, ((Date.now() - t) / 1000).toFixed(0) + 's', logs.filter((l) => /\[lv\] done|ERR|error/i.test(l)).slice(-6).join(' | '));
  await p.close();
}
await b.close();
