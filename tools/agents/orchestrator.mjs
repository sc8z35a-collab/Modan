#!/usr/bin/env node
// Modan Camp — 6-agent parallel build pipeline (v2)
//
//   1. asset-agent   : CC0 assets present, texture sizes, decimated _rt models + tri budgets, total size budget
//   2. build-agent   : production vite build, bundle budget, static lint (debugger / stray logs / TODO FIXME)
//   3. shader-agent  : GLSL patch targets are real three.js chunks, uniforms bound, mobile precision hazards
//   4. perf-agent    : quality-profile budgets, instance counts, snapshot tris / draw calls
//   5. mobile-agent  : landscape-only fullscreen phone UX: viewport, manifest, safe areas, touch targets (vh)
//   6. visual-agent  : image statistics of QA snapshots (.agents/shots) — exposure, clipping, contrast, saturation
//
// All 6 agents run concurrently (Promise.all). Each agent first runs deterministic local checks, then — if the
// OpenAI-compatible LLM API is reachable and funded — asks the LLM for a domain review (JSON findings) using a
// shared 6-slot concurrency pool with retries + model fallback. Findings from every agent are merged into
// .agents/BACKLOG.md so the next development iteration has a prioritized to-do list.
//
// Flags:
//   --commit          auto-commit report/backlog if all agents pass
//   --only=a,b        run a subset of agents
//   --skip-build      reuse existing dist/ (faster)
//   --watch           re-run on src/ changes (debounced)
//   --no-llm          force local mode
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { chat, apiHealth } from './lib/llm.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, '.agents');
fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k) => argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const sh = (c) => execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();

// ------------------------------------------------------------------ LLM review helper
const SYSTEM = (agent) => `You are the ${agent} in a 6-agent automated build pipeline for "Modan Camp", a WebGL2 three.js first-person camping game.
Target device: ONLY flagship Android phones (Snapdragon 8 Gen 3/Elite class, Adreno 750+), Chrome, fullscreen LANDSCAPE, touch only. Graphics should be pushed to the max; 60fps target.
Respond with JSON: {"findings":[{"severity":"high|medium|low","file":"path","title":"short","detail":"concrete actionable fix"}]} — max 6 findings, no prose outside JSON.`;

async function llmReview(agent, instruction, files, extra = '') {
  if (flag('no-llm')) return { mode: 'local', api: 'disabled' };
  const h = await apiHealth();
  if (!h.available) return { mode: 'local', api: h.status };
  const body = files.filter(exists).map((f) => `// FILE: ${f}\n${read(f).slice(0, 16000)}`).join('\n\n');
  const r = await chat([
    { role: 'system', content: SYSTEM(agent) },
    { role: 'user', content: `${instruction}\n${extra}\n\n${body}` },
  ], { models: ['gpt-5', 'gpt-5-mini'], json: true });
  if (!r.ok) return { mode: 'local', api: r.status };
  let findings = [];
  try { findings = JSON.parse(r.text.replace(/^```json|```$/g, '')).findings || []; } catch { findings = [{ severity: 'low', title: 'unparsed review', detail: r.text.slice(0, 600) }]; }
  return { mode: 'llm', api: 'ok', model: r.model, findings };
}

// ------------------------------------------------------------------ agents
const agents = {
  async 'asset-agent'() {
    const issues = [], info = {}, findings = [];
    const tex = ['aerial_grass_rock', 'forest_ground_04', 'rocky_terrain_02', 'coast_sand_rocks_02', 'pine_bark', 'bark_brown_02', 'brown_planks_05'];
    for (const t of tex) for (const k of ['diff', 'nor', 'arm']) if (!exists(`public/assets/textures/${t}/${k}.jpg`)) issues.push(`missing texture ${t}/${k}`);
    const models = ['boulder_01', 'rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'fern_02', 'shrub_01', 'dry_branches_medium_01', 'namaqualand_stones_01'];
    for (const m of models) {
      const p = `public/assets/models/${m}/${m}_rt.gltf`;
      if (!exists(p)) { issues.push(`missing decimated model ${m}`); continue; }
      const g = JSON.parse(read(p));
      const tris = g.meshes.reduce((s, me) => s + me.primitives.reduce((a, pr) => a + g.accessors[pr.indices].count / 3, 0), 0);
      info[m] = Math.round(tris);
      if (tris > 12000) issues.push(`${m} has ${Math.round(tris)} tris (>12k budget for instanced props)`);
      for (const b of g.buffers || []) if (b.uri && !b.uri.startsWith('data:') && !exists(`public/assets/models/${m}/${b.uri}`)) issues.push(`${m}: missing buffer ${b.uri}`);
    }
    const mb = +sh('du -sm public/assets').split('\t')[0];
    info.assetsMB = mb;
    if (mb > 60) issues.push(`assets ${mb}MB > 60MB budget`);
    if (mb > 40) findings.push({ severity: 'low', title: 'asset size', detail: `${mb}MB assets; consider KTX2/basis for GPU-compressed textures` });
    if (!exists('public/assets/CREDITS.md')) issues.push('missing CREDITS.md (CC0 attribution)');
    return { pass: issues.length === 0, issues, info, findings };
  },

  async 'build-agent'() {
    const t0 = Date.now(), issues = [], findings = [];
    if (!flag('skip-build')) {
      await new Promise((res, rej) => {
        const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; p.stderr.on('data', (d) => (err += d));
        p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(0, 800)))));
      });
    }
    const dir = path.join(ROOT, 'dist/assets');
    const js = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
    const kb = js.reduce((s, f) => s + fs.statSync(path.join(dir, f)).size, 0) / 1024;
    if (kb > 1600) issues.push(`JS bundle ${kb.toFixed(0)}KB > 1600KB budget`);
    // static lint over all sources
    const files = sh('git ls-files src').trim().split('\n').filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const s = read(f);
      if (/\bdebugger;/.test(s)) issues.push(`${f}: debugger statement`);
      const logs = s.split('\n').filter((l) => /console\.log\(/.test(l) && !/\[(load|snap)\]/.test(l));
      if (logs.length) issues.push(`${f}: ${logs.length} stray console.log`);
      for (const m of s.matchAll(/\/\/\s*(TODO|FIXME|HACK)[: ](.*)/g)) findings.push({ severity: 'low', file: f, title: m[1], detail: m[2].trim() });
      // per-frame allocations: `new THREE.Vector3|Matrix4|Color|Quaternion` inside update()/frame() bodies (lazy `||` caches excluded)
      for (const m of s.matchAll(/\n\s{2}(update|frame|loop)\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{2}\}/g)) {
        const hot = m[2].split("\n").filter((l) => /new THREE\.(Vector[234]|Matrix4|Color|Quaternion|Euler)\(/.test(l) && !/\|\|\s*\(|\?\?=/.test(l) && !/^\s*\w+:\s*new THREE/.test(l));
        if (hot.length) findings.push({ severity: 'medium', file: f, title: `per-frame allocation in ${m[1]}()`, detail: `${hot.length} THREE object allocations per frame; hoist to fields to avoid GC hitches` });
      }
    }
    const review = await llmReview('build/code-review agent', 'Code-review the most recently changed game files for bugs, leaks, race conditions, and gameplay logic errors.', recentFiles(3));
    return { pass: issues.length === 0, issues, findings, review, info: { bundleKB: Math.round(kb), buildMs: Date.now() - t0, lintedFiles: files.length } };
  },

  async 'shader-agent'() {
    const issues = [], findings = [];
    const files = sh('grep -rl "onBeforeCompile\\|ShaderMaterial" src').trim().split('\n');
    for (const f of files) {
      const s = read(f);
      for (const m of s.matchAll(/replace\(\s*'#include <([a-z_]+)>'/g)) {
        if (!fs.existsSync(path.join(ROOT, 'node_modules/three/src/renderers/shaders/ShaderChunk', m[1] + '.glsl.js'))) issues.push(`${f}: unknown shader chunk <${m[1]}>`);
      }
      for (const m of s.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)/g)) {
        const bound = new RegExp(`${m[1]}\\s*[:=]|uniforms\\.${m[1]}|${m[1]}: \\{`).test(s) || /Object\.assign\(sh\.uniforms/.test(s) || /uniforms:\s*[A-Za-z]/.test(s) || /\.\.\.[A-Za-z.]*[uU]/.test(s);
        if (!bound) issues.push(`${f}: uniform ${m[1]} declared but never bound`);
      }
      // mobile hazards
      if (/pow\(\s*[a-z]/.test(s) && !/max\(/.test(s)) findings.push({ severity: 'low', file: f, title: 'pow() of possibly negative base', detail: 'undefined on Adreno/Mali; clamp base with max(x, 0.0)' });
      if (/\bdiscard\b/.test(s) && /transparent:\s*true/.test(s)) findings.push({ severity: 'low', file: f, title: 'discard + blending', detail: 'alpha-tested and blended in same material defeats early-Z on tiled GPUs' });
    }
    const review = await llmReview('shader-agent', 'Review these GLSL / onBeforeCompile patches for correctness, precision (mediump) issues on Adreno GPUs, visual quality upgrades, and cost.', files.slice(0, 4));
    return { pass: issues.length === 0, issues, findings, review, info: { files: files.length } };
  },

  async 'perf-agent'() {
    const issues = [], info = {}, findings = [];
    const r = read('src/core/renderer.js');
    const ultra = r.match(/ultra: \{([^}]*)\}/)[1];
    info.ultra = ultra.trim();
    if (!/shadow: 4096/.test(ultra)) issues.push('ultra profile should use 4096 shadow map on flagship phones');
    const grass = read('src/world/grass.js');
    const blades = [...grass.matchAll(/makeLayer\(Math\.round\((\d+) \* density\)/g)].reduce((s, m) => s + +m[1], 0);
    info.grassBlades = blades;
    if (blades > 600000) issues.push(`grass ${blades} blades > 600k budget`);
    const w = read('src/world/world.js');
    info.treeAttempts = +w.match(/Math\.round\((\d+) \* this\.q\.trees\)/)?.[1];
    if (/_1k\.gltf/.test(w)) issues.push('world.js loads full-res _1k models; use decimated _rt models');
    const lights = sh('grep -rhoc "new THREE.PointLight" src').trim().split('\n').reduce((a, b) => a + +b, 0);
    info.pointLights = lights;
    if (lights > 12) findings.push({ severity: 'medium', title: 'point lights', detail: `${lights} PointLights: every forward-lit material pays for all of them; pool or cull by distance` });
    const shots = path.join(OUT, 'shots');
    if (fs.existsSync(shots)) for (const f of fs.readdirSync(shots).filter((x) => x.endsWith('.json'))) {
      const j = JSON.parse(fs.readFileSync(path.join(shots, f)));
      info['snap_' + f.replace('.json', '')] = { tris: j.tris, calls: j.calls };
      if (j.tris > 12e6) issues.push(`snapshot ${f}: ${(j.tris / 1e6).toFixed(1)}M tris > 12M budget`);
      if (j.calls > 3000) issues.push(`snapshot ${f}: ${j.calls} draw calls > 3000 budget`);
    }
    const review = await llmReview('perf-agent', 'Identify the top GPU/CPU performance risks for 60fps on a Snapdragon 8 Elite phone at DPR 2 landscape, and where quality can be raised for free.', ['src/core/renderer.js', 'src/world/grass.js', 'src/world/scatter.js', 'src/world/water.js']);
    return { pass: issues.length === 0, issues, info, findings, review };
  },

  async 'mobile-agent'() {
    const issues = [], findings = [];
    const html = read('index.html'), css = read('src/ui/style.css'), main = read('src/main.js'), input = read('src/core/input.js');
    const mani = JSON.parse(read('public/manifest.webmanifest'));
    if (!/viewport-fit=cover/.test(html)) issues.push('viewport meta lacks viewport-fit=cover');
    if (!/user-scalable=no/.test(html)) issues.push('pinch zoom not disabled');
    if (mani.orientation !== 'landscape' || mani.display !== 'fullscreen') issues.push('manifest must be landscape + fullscreen');
    if (!mani.icons?.length) findings.push({ severity: 'low', file: 'public/manifest.webmanifest', title: 'no icons', detail: 'Add 192/512 icons so "Add to Home screen" installs as fullscreen PWA' });
    if (!/orientation: portrait/.test(css)) issues.push('no portrait "rotate device" overlay');
    if (!/safe-area-inset/.test(css)) issues.push('no safe-area insets (punch-hole cameras)');
    if (!/touch-action: none/.test(css)) issues.push('touch-action not disabled');
    if (!/requestFullscreen/.test(main) || !/orientation\?\.lock/.test(main)) issues.push('fullscreen/orientation lock missing on start');
    if (!/touchstart/.test(input)) issues.push('no touch controls');
    const pxFonts = [...css.matchAll(/font-size:\s*(\d+)px/g)].length;
    if (pxFonts > 0) issues.push(`${pxFonts} px-based font sizes (use vh for landscape phones)`);
    // touch targets: buttons sized in vh must be >= 6vh (~ 25px on a 412px-tall landscape phone ≈ 7mm)
    for (const m of css.matchAll(/([.#][\w-]+)\s*\{[^}]*?\bwidth:\s*([\d.]+)vh;\s*height:\s*([\d.]+)vh/g)) {
      if (/btn|round|act|icon/.test(m[1]) && Math.min(+m[2], +m[3]) < 6) issues.push(`${m[1]} touch target ${m[2]}x${m[3]}vh < 6vh`);
    }
    for (const m of css.matchAll(/font-size:\s*([\d.]+)vh/g)) if (+m[1] < 1.5) findings.push({ severity: 'low', file: 'src/ui/style.css', title: 'tiny text', detail: `font-size ${m[1]}vh is < 1.5vh (~6px on landscape phones)` });
    if (!/wakeLock/.test(main)) findings.push({ severity: 'medium', file: 'src/main.js', title: 'screen sleep', detail: 'use navigator.wakeLock.request("screen") so the phone does not dim during idle camp moments' });
    const review = await llmReview('mobile-agent', 'Check the landscape-only mobile UX: touch target sizes, thumb reach, readability at arm length, safe areas, fullscreen robustness, haptics.', ['index.html', 'src/ui/style.css', 'src/core/input.js']);
    return { pass: issues.length === 0, issues, findings, review };
  },

  async 'visual-agent'() {
    const issues = [], findings = [], info = {};
    const dir = path.join(OUT, 'shots');
    const shots = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(png|jpg)$/.test(f)) : [];
    if (!shots.length) return { pass: true, issues, findings: [{ severity: 'low', title: 'no QA shots', detail: 'run tools/qa-server.mjs and open ?snap=… on a GPU browser' }], info };
    const sharp = (await import('sharp')).default;
    for (const f of shots) {
      const img = sharp(path.join(dir, f));
      const { data, info: m } = await img.raw().toBuffer({ resolveWithObject: true });
      let sum = 0, clipHi = 0, clipLo = 0, sat = 0, sq = 0; const n = m.width * m.height, c = m.channels;
      for (let i = 0; i < data.length; i += c) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; sum += l; sq += l * l;
        if (l > 250) clipHi++; if (l < 4) clipLo++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b); sat += mx ? (mx - mn) / mx : 0;
      }
      const mean = sum / n, std = Math.sqrt(sq / n - mean * mean);
      const s = { mean: +mean.toFixed(1), contrast: +std.toFixed(1), clipHi: +(clipHi / n * 100).toFixed(2), clipLo: +(clipLo / n * 100).toFixed(2), sat: +(sat / n).toFixed(3) };
      info[f] = s;
      const night = /night|dusk|star/.test(f);
      if (!night && s.mean < 55) findings.push({ severity: 'medium', file: f, title: 'underexposed day shot', detail: `mean luma ${s.mean}` });
      if (!night && s.mean > 200) findings.push({ severity: 'medium', file: f, title: 'overexposed', detail: `mean luma ${s.mean}` });
      if (night && s.mean < 8) findings.push({ severity: 'medium', file: f, title: 'night too dark to read', detail: `mean luma ${s.mean}; raise moonlight/ambient` });
      if (s.clipHi > 6) findings.push({ severity: 'medium', file: f, title: 'highlight clipping', detail: `${s.clipHi}% pixels clipped` });
      if (s.clipLo > 25) findings.push({ severity: 'medium', file: f, title: 'crushed blacks', detail: `${s.clipLo}% pixels near black` });
      if (s.contrast < 18) findings.push({ severity: 'low', file: f, title: 'flat image', detail: `luma std ${s.contrast}` });
      if (mean < 1 || s.contrast < 1) issues.push(`${f}: blank/black frame (render failure)`);
    }
    // LLM vision review of up to 3 shots
    let review = { mode: 'local', api: 'n/a' };
    if (!flag('no-llm')) {
      const h = await apiHealth();
      review = { mode: 'local', api: h.status };
      if (h.available) {
        const imgs = await Promise.all(shots.slice(0, 3).map(async (f) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + (await sharp(path.join(dir, f)).resize(640).jpeg({ quality: 70 }).toBuffer()).toString('base64') } })));
        const r = await chat([{ role: 'system', content: SYSTEM('visual/art-direction agent') }, { role: 'user', content: [{ type: 'text', text: 'Art-direct these in-game screenshots (landscape phone). Aim: photoreal cozy lakeside forest camp. What looks fake/cheap and how to fix it in three.js?' }, ...imgs] }], { models: ['gpt-5', 'gpt-5-mini'], json: true });
        if (r.ok) { try { review = { mode: 'llm', api: 'ok', model: r.model, findings: JSON.parse(r.text).findings || [] }; } catch { review = { mode: 'llm', api: 'ok', findings: [{ severity: 'low', title: 'raw', detail: r.text.slice(0, 600) }] }; } }
        else review.api = r.status;
      }
    }
    return { pass: issues.length === 0, issues, findings, review, info };
  },
};

function recentFiles(n) {
  try { return sh('git log --name-only --pretty=format: -n 12 -- src').split('\n').filter(Boolean).filter((f, i, a) => a.indexOf(f) === i && exists(f)).slice(0, n); } catch { return []; }
}

// ------------------------------------------------------------------ run
async function runAll() {
  const t0 = Date.now();
  const health = flag('no-llm') ? { available: false, status: 'disabled' } : await apiHealth();
  console.log(`LLM API: ${health.available ? `AVAILABLE (${health.model}, ${health.ms}ms)` : 'UNAVAILABLE'} [${health.status}]${health.detail ? ' - ' + health.detail.slice(0, 120) : ''}`);
  const only = opt('only')?.split(',');
  const list = Object.entries(agents).filter(([n]) => !only || only.some((o) => n.startsWith(o)));
  console.log(`Launching ${list.length} agents in parallel: ${list.map(([n]) => n).join(', ')}`);
  const results = await Promise.all(list.map(async ([name, fn]) => {
    const s = Date.now();
    try { const r = await fn(); console.log(`  ${r.pass ? '✔' : '✖'} ${name} done in ${Date.now() - s}ms`); return { name, ms: Date.now() - s, ...r }; }
    catch (e) { return { name, ms: Date.now() - s, pass: false, issues: ['CRASH: ' + e.message] }; }
  }));
  const allPass = results.every((r) => r.pass);
  const report = { at: new Date().toISOString(), totalMs: Date.now() - t0, llm: health, allPass, results };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  const md = [`# Agent pipeline report`, ``, `- time: ${report.at}`, `- LLM API: **${health.available ? 'available' : 'unavailable'}** (${health.status})`, `- agents: ${results.length} in parallel`, `- result: **${allPass ? 'ALL PASS' : 'ISSUES FOUND'}** in ${report.totalMs}ms`, ``];
  for (const r of results) {
    md.push(`## ${r.pass ? '✅' : '❌'} ${r.name} (${r.ms}ms)`);
    if (r.info) md.push('```json\n' + JSON.stringify(r.info, null, 1) + '\n```');
    for (const i of r.issues || []) md.push(`- ❗ ${i}`);
    if (r.review) md.push(r.review.mode === 'llm' ? `- review: LLM (${r.review.model}) — ${r.review.findings.length} findings` : `- review: local (LLM ${r.review.api})`);
    md.push('');
  }
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), md.join('\n'));

  // merged, prioritized backlog
  const rank = { high: 0, medium: 1, low: 2 };
  const all = results.flatMap((r) => [
    ...(r.issues || []).map((i) => ({ agent: r.name, severity: 'high', title: 'gate failure', detail: i })),
    ...(r.findings || []).map((f) => ({ agent: r.name, ...f })),
    ...(r.review?.findings || []).map((f) => ({ agent: r.name + ' (LLM)', ...f })),
  ]).sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  const bl = [`# Backlog (auto-generated by 6-agent pipeline)`, ``, `_${report.at}_`, ``, '| sev | agent | file | item |', '|---|---|---|---|',
    ...all.map((f) => `| ${f.severity} | ${f.agent} | ${f.file || ''} | **${f.title}** — ${String(f.detail || '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`)];
  fs.writeFileSync(path.join(OUT, 'BACKLOG.md'), bl.join('\n') + '\n');

  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(14)} ${String(r.ms).padStart(6)}ms  ${(r.issues || []).join(' | ')}`);
  console.log(`${all.length} backlog items -> .agents/BACKLOG.md`);
  console.log(allPass ? '\nALL AGENTS PASS' : '\nSOME AGENTS REPORTED ISSUES');
  if (flag('commit') && allPass) {
    try { execSync('git add .agents/REPORT.md .agents/report.json .agents/BACKLOG.md && git commit -qm "chore(agents): pipeline report"', { cwd: ROOT }); console.log('report committed'); } catch { /* nothing to commit */ }
  }
  return allPass;
}

if (flag('watch')) {
  let timer = null, running = false;
  const trigger = () => { clearTimeout(timer); timer = setTimeout(async () => { if (running) return trigger(); running = true; await runAll(); running = false; }, 1500); };
  await runAll();
  fs.watch(path.join(ROOT, 'src'), { recursive: true }, trigger);
  console.log('watching src/ …');
} else {
  process.exit((await runAll()) ? 0 : 1);
}
