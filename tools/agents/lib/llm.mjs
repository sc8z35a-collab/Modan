// OpenAI-compatible LLM client for the agent pipeline.
// - reads ~/.genspark_llm.yaml or OPENAI_* env
// - global concurrency limit (default 6 = one slot per agent)
// - retry w/ exponential backoff on 429/5xx/network, model fallback chain
// - detects Genspark proxy soft-errors (x_genspark.code, e.g. free_plan_block) which come back as HTTP 200
import fs from 'fs';
import os from 'os';
import path from 'path';

export function llmConfig() {
  let key = process.env.OPENAI_API_KEY, base = process.env.OPENAI_BASE_URL;
  const f = path.join(os.homedir(), '.genspark_llm.yaml');
  if (fs.existsSync(f)) {
    const y = fs.readFileSync(f, 'utf8');
    key = y.match(/api_key:\s*(\S+)/)?.[1] || key;
    base = y.match(/base_url:\s*(\S+)/)?.[1] || base;
  }
  return { key, base: base?.replace(/\/$/, '') };
}

const MAX = +(process.env.AGENT_LLM_CONCURRENCY || 6);
let active = 0; const queue = [];
const acquire = () => new Promise((r) => { if (active < MAX) { active++; r(); } else queue.push(r); });
const release = () => { const n = queue.shift(); if (n) n(); else active--; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HARD = new Set(['free_plan_block', 'credit_exhausted', 'not_configured', 'invalid_api_key', 'http_401', 'http_403']);

export async function chat(messages, { models = ['gpt-5', 'gpt-5-mini'], retries = 3, timeoutMs = 240000, json = false } = {}) {
  const { key, base } = llmConfig();
  if (!key || !base) return { ok: false, status: 'not_configured' };
  let last = { ok: false, status: 'unknown' };
  for (const model of models) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      await acquire();
      try {
        const body = { model, messages };
        if (json) body.response_format = { type: 'json_object' };
        const r = await fetch(`${base}/chat/completions`, {
          method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
        });
        const j = await r.json().catch(() => ({}));
        if (j.x_genspark?.code) last = { ok: false, status: j.x_genspark.code, detail: j.choices?.[0]?.message?.content };
        else if (!r.ok) last = { ok: false, status: `http_${r.status}`, detail: JSON.stringify(j).slice(0, 200) };
        else return { ok: true, status: 'ok', model, text: j.choices?.[0]?.message?.content || '', usage: j.usage };
      } catch (e) { last = { ok: false, status: 'network', detail: e.message }; }
      finally { release(); }
      if (HARD.has(last.status)) return last;            // account-level: no point retrying
      if (last.status === 'http_400') break;              // bad model/params: try next model
      await sleep(800 * 2 ** attempt + Math.random() * 400);
    }
  }
  return last;
}

let health = null;
export async function apiHealth() {
  if (health) return health;
  const t0 = Date.now();
  const r = await chat([{ role: 'user', content: 'Reply with exactly: OK' }], { models: ['gpt-5-nano', 'gpt-5-mini'], retries: 1, timeoutMs: 60000 });
  health = { available: r.ok && /OK/i.test(r.text || ''), status: r.status, model: r.model, ms: Date.now() - t0, detail: r.ok ? '' : (r.detail || '').slice(0, 200) };
  return health;
}
