#!/usr/bin/env node
// 6-agent parallel build pipeline for Modan Camp.
//
//   1. asset-agent     : verifies all CC0 assets exist, sizes, decimated _rt models present
//   2. build-agent     : production vite build, bundle size budget
//   3. shader-agent    : static GLSL sanity checks (uniform/varying declarations used by onBeforeCompile patches)
//   4. perf-agent      : static budget analysis (instance counts, shadow maps, draw-call estimate)
//   5. mobile-agent    : landscape-only / fullscreen / touch / safe-area requirements in HTML+CSS+JS
//   6. review-agent    : LLM code review (OpenAI-compatible proxy) of the most recently changed files
//
// Every agent runs concurrently. If the LLM API is reachable and funded, agents 3-6 additionally ask
// the LLM for review notes; otherwise they fall back to deterministic local checks and report
// the API status. Results are written to .agents/report.json and .agents/REPORT.md.
// Flags: --commit  -> auto-commit the report if all agents pass
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, '.agents');
fs.mkdirSync(OUT, { recursive: true });
const args = new Set(process.argv.slice(2));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ---------------------------------------------------------------- LLM client
function llmConfig() {
  let key = process.env.OPENAI_API_KEY, base = process.env.OPENAI_BASE_URL;
  const f = path.join(os.homedir(), '.genspark_llm.yaml');
  if (fs.existsSync(f)) {
    const y = fs.readFileSync(f, 'utf8');
    key = y.match(/api_key:\s*(\S+)/)?.[1] || key;
    base = y.match(/base_url:\s*(\S+)/)?.[1] || base;
  }
  return { key, base };
}

async function llm(messages, model = 'gpt-5-mini') {
  const { key, base } = llmConfig();
  if (!key || !base) return { ok: false, status: 'not_configured' };
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages }), signal: AbortSignal.timeout(180000),
    });
    const j = await r.json();
    if (j.x_genspark?.code) return { ok: false, status: j.x_genspark.code, text: j.choices?.[0]?.message?.content };
    if (!r.ok) return { ok: false, status: `http_${r.status}` };
    return { ok: true, status: 'ok', text: j.choices[0].message.content };
  } catch (e) { return { ok: false, status: 'error:' + e.message }; }
}

let apiState = null;
async function apiHealth() {
  if (apiState) return apiState;
  const r = await llm([{ role: 'user', content: 'Reply with exactly: OK' }], 'gpt-5-nano');
  apiState = { available: r.ok && /OK/.test(r.text || ''), status: r.status, detail: r.ok ? '' : (r.text || '').slice(0, 160) };
  return apiState;
}

async function llmReview(agent, instruction, files) {
  const h = await apiHealth();
  if (!h.available) return { mode: 'local', api: h.status };
  const body = files.map((f) => `// FILE: ${f}\n${read(f).slice(0, 14000)}`).join('\n\n');
  const r = await llm([
    { role: 'system', content: `You are the ${agent} of a 6-agent build pipeline for a WebGL (three.js) camping game that is played ONLY on high-end Android phones in fullscreen landscape. Be concise: list up to 6 concrete, actionable findings with file names. No preamble.` },
    { role: 'user', content: `${instruction}\n\n${body}` },
  ], 'gpt-5');
  return { mode: 'llm', api: r.status, notes: r.text };
}

// ---------------------------------------------------------------- agents
const agents = {
  async 'asset-agent'() {
    const issues = [], info = {};
    const tex = ['aerial_grass_rock', 'forest_ground_04', 'rocky_terrain_02', 'coast_sand_rocks_02', 'pine_bark', 'bark_brown_02', 'brown_planks_05'];
    for (const t of tex) for (const k of ['diff', 'nor', 'arm']) if (!exists(`public/assets/textures/${t}/${k}.jpg`)) issues.push(`missing texture ${t}/${k}`);
    const models = ['boulder_01', 'rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'fern_02', 'shrub_01', 'dry_branches_medium_01', 'namaqualand_stones_01'];
    let rtTris = 0;
    for (const m of models) {
      const p = `public/assets/models/${m}/${m}_rt.gltf`;
      if (!exists(p)) { issues.push(`missing decimated model ${m}`); continue; }
      const g = JSON.parse(read(p));
      const tris = g.meshes.reduce((s, me) => s + me.primitives.reduce((a, pr) => a + g.accessors[pr.indices].count / 3, 0), 0);
      info[m] = Math.round(tris); rtTris += tris;
      if (tris > 12000) issues.push(`${m} has ${Math.round(tris)} tris (>12k budget for instanced props)`);
    }
    const du = execSync('du -sm public/assets', { cwd: ROOT }).toString().split('\t')[0];
    info.assetsMB = +du;
    if (+du > 60) issues.push(`assets ${du}MB > 60MB budget`);
    if (!exists('public/assets/CREDITS.md')) issues.push('missing CREDITS.md (CC0 attribution)');
    return { pass: issues.length === 0, issues, info };
  },

  async 'build-agent'() {
    const t0 = Date.now();
    await new Promise((res, rej) => {
      const p = spawn('npx', ['vite', 'build', '--logLevel', 'error'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; p.stderr.on('data', (d) => (err += d));
      p.on('close', (c) => (c === 0 ? res() : rej(new Error(err.slice(0, 800)))));
    });
    const js = fs.readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.js'));
    const kb = js.reduce((s, f) => s + fs.statSync(path.join(ROOT, 'dist/assets', f)).size, 0) / 1024;
    const issues = kb > 1600 ? [`JS bundle ${kb.toFixed(0)}KB > 1600KB budget`] : [];
    return { pass: issues.length === 0, issues, info: { bundleKB: Math.round(kb), buildMs: Date.now() - t0 } };
  },

  async 'shader-agent'() {
    const issues = [];
    const files = execSync('grep -rl "onBeforeCompile\\|ShaderMaterial" src', { cwd: ROOT }).toString().trim().split('\n');
    for (const f of files) {
      const s = read(f);
      // every .replace('#include <x>' patch target must be a real three.js chunk
      for (const m of s.matchAll(/replace\('#include <([a-z_]+)>'/g)) {
        const chunk = path.join(ROOT, 'node_modules/three/src/renderers/shaders/ShaderChunk', m[1] + '.glsl.js');
        if (!fs.existsSync(chunk)) issues.push(`${f}: unknown shader chunk <${m[1]}>`);
      }
      // uniforms referenced in GLSL must be declared
      for (const m of s.matchAll(/uniform\s+\w+\s+(u[A-Z]\w*)/g)) {
        if (!new RegExp(`${m[1]}\\s*[:=]|uniforms\\.${m[1]}|${m[1]}: \\{`).test(s) && !/Object\.assign\(sh\.uniforms/.test(s)) issues.push(`${f}: uniform ${m[1]} declared but never bound`);
      }
    }
    const review = await llmReview('shader-agent', 'Review these GLSL/onBeforeCompile patches for correctness, precision issues on Adreno/Mali GPUs, and cost.', files.slice(0, 3));
    return { pass: issues.length === 0, issues, info: { files: files.length }, review };
  },

  async 'perf-agent'() {
    const issues = [], info = {};
    const r = read('src/core/renderer.js');
    const ultra = r.match(/ultra: \{([^}]*)\}/)[1];
    info.ultra = ultra.trim();
    if (!/shadow: 4096/.test(ultra)) issues.push('ultra profile should use 4096 shadow map on flagship phones');
    const grass = read('src/world/grass.js');
    const blades = [...grass.matchAll(/makeLayer\(Math\.round\((\d+) \* density\)/g)].reduce((s, m) => s + +m[1], 0);
    info.grassBlades = blades;
    if (blades > 600000) issues.push(`grass ${blades} blades > 600k budget`);
    const w = read('src/world/world.js');
    const trees = +w.match(/Math\.round\((\d+) \* this\.q\.trees\)/)?.[1];
    info.treeAttempts = trees;
    if (/_1k\.gltf/.test(w)) issues.push('world.js loads full-res _1k models; use decimated _rt models');
    // snapshot stats from remote QA (if any)
    const shots = path.join(OUT, 'shots');
    if (fs.existsSync(shots)) {
      for (const f of fs.readdirSync(shots).filter((x) => x.endsWith('.json'))) {
        const j = JSON.parse(fs.readFileSync(path.join(shots, f)));
        info['snap_' + f.replace('.json', '')] = { tris: j.tris, calls: j.calls };
        if (j.tris > 12e6) issues.push(`snapshot ${f}: ${(j.tris / 1e6).toFixed(1)}M tris > 12M budget`);
      }
    }
    const review = await llmReview('perf-agent', 'Identify the top GPU/CPU performance risks for a Snapdragon 8-class phone at 60fps.', ['src/world/scatter.js', 'src/world/grass.js', 'src/core/renderer.js']);
    return { pass: issues.length === 0, issues, info, review };
  },

  async 'mobile-agent'() {
    const issues = [];
    const html = read('index.html'), css = read('src/ui/style.css'), main = read('src/main.js'), input = read('src/core/input.js');
    const mani = JSON.parse(read('public/manifest.webmanifest'));
    if (!/viewport-fit=cover/.test(html)) issues.push('viewport meta lacks viewport-fit=cover');
    if (!/user-scalable=no/.test(html)) issues.push('pinch zoom not disabled');
    if (mani.orientation !== 'landscape' || mani.display !== 'fullscreen') issues.push('manifest must be landscape + fullscreen');
    if (!/orientation: portrait/.test(css)) issues.push('no portrait "rotate device" overlay');
    if (!/safe-area-inset/.test(css)) issues.push('no safe-area insets (punch-hole cameras)');
    if (!/touch-action: none/.test(css)) issues.push('touch-action not disabled');
    if (!/requestFullscreen/.test(main) || !/orientation\?\.lock/.test(main)) issues.push('fullscreen/orientation lock missing on start');
    if (!/touchstart/.test(input)) issues.push('no touch controls');
    // font sizes in vh so they scale with landscape phone height
    const pxFonts = [...css.matchAll(/font-size:\s*(\d+)px/g)].length;
    if (pxFonts > 0) issues.push(`${pxFonts} px-based font sizes (use vh for landscape phones)`);
    const review = await llmReview('mobile-agent', 'Check the landscape-only mobile UX: touch target sizes, thumb reach, readability, safe areas.', ['index.html', 'src/ui/style.css', 'src/core/input.js']);
    return { pass: issues.length === 0, issues, review };
  },

  async 'review-agent'() {
    let changed = [];
    try { changed = execSync('git diff --name-only HEAD~5 -- src', { cwd: ROOT }).toString().trim().split('\n').filter(Boolean).filter(exists); } catch { /* shallow */ }
    const issues = [];
    for (const f of changed) {
      const s = read(f);
      if (/console\.log\(/.test(s) && !/\[load\]|\[snap\]/.test(s)) issues.push(`${f}: stray console.log`);
      if (/debugger;/.test(s)) issues.push(`${f}: debugger statement`);
    }
    const review = await llmReview('review-agent', 'Code review the recently changed game files for bugs, leaks, and gameplay logic errors.', changed.slice(0, 3));
    return { pass: issues.length === 0, issues, info: { changed }, review };
  },
};

// ---------------------------------------------------------------- run all 6 in parallel
const t0 = Date.now();
const health = await apiHealth();
console.log(`LLM API: ${health.available ? 'AVAILABLE' : 'UNAVAILABLE'} (${health.status})${health.detail ? ' - ' + health.detail : ''}`);
console.log(`Launching ${Object.keys(agents).length} agents in parallel…`);
const results = await Promise.all(Object.entries(agents).map(async ([name, fn]) => {
  const s = Date.now();
  try { const r = await fn(); return { name, ms: Date.now() - s, ...r }; }
  catch (e) { return { name, ms: Date.now() - s, pass: false, issues: ['CRASH: ' + e.message] }; }
}));
const allPass = results.every((r) => r.pass);
const report = { at: new Date().toISOString(), totalMs: Date.now() - t0, llm: health, allPass, results };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const md = [`# Agent pipeline report`, ``, `- time: ${report.at}`, `- LLM API: **${health.available ? 'available' : 'unavailable'}** (${health.status})`, `- result: **${allPass ? 'ALL PASS' : 'ISSUES FOUND'}** in ${report.totalMs}ms`, ``];
for (const r of results) {
  md.push(`## ${r.pass ? '✅' : '❌'} ${r.name} (${r.ms}ms)`);
  if (r.info) md.push('```json\n' + JSON.stringify(r.info, null, 1) + '\n```');
  for (const i of r.issues || []) md.push(`- ${i}`);
  if (r.review) md.push(r.review.mode === 'llm' ? `\n**LLM review:**\n\n${r.review.notes}` : `- review mode: local (LLM ${r.review.api})`);
  md.push('');
}
fs.writeFileSync(path.join(OUT, 'REPORT.md'), md.join('\n'));
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(14)} ${String(r.ms).padStart(6)}ms  ${(r.issues || []).join(' | ')}`);
console.log(allPass ? '\nALL AGENTS PASS' : '\nSOME AGENTS REPORTED ISSUES');
if (args.has('--commit')) {
  try { execSync('git add .agents/REPORT.md .agents/report.json && git commit -qm "chore(agents): pipeline report"', { cwd: ROOT }); } catch { /* nothing to commit */ }
}
process.exit(allPass ? 0 : 1);
