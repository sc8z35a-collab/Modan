// Downloads CC0 assets from Poly Haven (https://polyhaven.com, CC0 license) into public/assets.
// Idempotent: skips files that already exist.
import fs from 'fs';
import path from 'path';

const OUT = path.resolve('public/assets');
const API = 'https://api.polyhaven.com';

// textures: [id, resolution]
export const TEXTURES = [
  ['forest_ground_04', '2k'],
  ['aerial_grass_rock', '2k'],
  ['brown_planks_05', '1k'],
  ['forrest_ground_01', '2k'],
  ['rocky_terrain_02', '2k'],
  ['pine_bark', '1k'],
  ['bark_brown_02', '1k'],
  ['coast_sand_rocks_02', '1k'],
];
// models: [id, resolution]
export const MODELS = [
  ['boulder_01', '1k'],
  ['rock_moss_set_01', '1k'],
  ['tree_stump_01', '1k'],
  ['dead_tree_trunk', '1k'],
  ['fern_02', '1k'],
  ['shrub_01', '1k'],
  ['dry_branches_medium_01', '1k'],
  ['namaqualand_stones_01', '1k'],
];

async function dl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status + ' ' + url);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}

async function fetchTexture(id, res) {
  const files = await (await fetch(`${API}/files/${id}`)).json();
  const pick = (k) => files[k]?.[res]?.jpg?.url;
  const maps = { diff: pick('Diffuse'), nor: pick('nor_gl'), arm: pick('arm') || pick('rough_ao') || pick('Rough') };
  for (const [k, url] of Object.entries(maps)) {
    if (!url) continue;
    await dl(url, path.join(OUT, 'textures', id, `${k}.jpg`));
  }
  console.log('[tex]', id);
}

async function fetchModel(id, res) {
  const files = await (await fetch(`${API}/files/${id}`)).json();
  const g = files.gltf[res].gltf;
  const dir = path.join(OUT, 'models', id);
  await dl(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, v] of Object.entries(g.include || {})) await dl(v.url, path.join(dir, rel));
  console.log('[model]', id);
}

export async function fetchAll() {
  const jobs = [...TEXTURES.map(([i, r]) => () => fetchTexture(i, r)), ...MODELS.map(([i, r]) => () => fetchModel(i, r))];
  // limited concurrency
  const q = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (q.length) await q.shift()(); }));
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'),
    '# Asset credits\n\nAll textures and models are from [Poly Haven](https://polyhaven.com) and are licensed CC0 (public domain).\n\n' +
    [...TEXTURES, ...MODELS].map(([i]) => `- ${i}: https://polyhaven.com/a/${i}`).join('\n') + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) fetchAll().then(() => console.log('done'));
