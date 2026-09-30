// usage: node tools/c/nshot.mjs out.png "cam=..&look=..&hours=10" [more "out2.png" "qs2" ...]   (vite dev on :5174)
import { chromium } from 'playwright';
const a = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--renderer-process-limit=1'] });
for (let i = 0; i < a.length; i += 2) {
  const [out, qs = ''] = [a[i], a[i + 1]];
  const w = +(new URLSearchParams(qs).get('w') || 900), h = +(new URLSearchParams(qs).get('h') || 500);
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
  const t = Date.now();
  await p.goto(`http://localhost:${process.env.PORT || 5174}/tools/c/natureview.html?${qs}`, { timeout: 120000 });
  await p.waitForFunction(() => document.title === 'READY' || document.title === 'ERR', null, { timeout: 600000 }).catch(() => logs.push('TIMEOUT'));
  await p.screenshot({ path: out, timeout: 300000 });
  console.log(out, ((Date.now() - t) / 1000).toFixed(0) + 's', logs.filter((l) => !/vite|DevTools|\[nv\].*(地形|森|岩)/.test(l)).slice(-12).join('\n'));
  await p.close();
}
await b.close();
