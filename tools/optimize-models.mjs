// Decimates the Poly Haven source models for real-time instancing (meshoptimizer simplify).
// Writes public/assets/models/<id>/<id>_rt.gltf (+ .bin), reusing the original textures.
import { NodeIO } from '@gltf-transform/core';
import { weld, simplify, prune, dedup } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';
import path from 'path';

// target triangle ratio per model (source tris in comments)
const TARGETS = {
  boulder_01: 0.04,          // 66k -> ~2.6k
  rock_moss_set_01: 0.06,    // 63k -> ~3.8k
  namaqualand_stones_01: 0.04, // 70k -> ~2.8k
  tree_stump_01: 0.06,       // 41k -> ~2.5k
  dead_tree_trunk: 0.05,     // 101k -> ~5k (interactive, close-up)
  fern_02: 0.35,             // 6k -> 3k (alpha cards: keep silhouette)
  shrub_01: 0.06,            // 156k -> ~9k
  dry_branches_medium_01: 0.25, // 16k -> 4k
};

await MeshoptSimplifier.ready;
const io = new NodeIO();
for (const [id, ratio] of Object.entries(TARGETS)) {
  const dir = path.resolve('public/assets/models', id);
  const src = path.join(dir, `${id}_1k.gltf`);
  if (!fs.existsSync(src)) { console.warn('missing', src); continue; }
  const doc = await io.read(src);
  const count = () => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() || 0) / 3, 0), 0);
  const before = count();
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }), dedup(), prune());
  if (count() > before * ratio * 2) {
    // stubborn meshes (UV seams): sloppy simplification on raw index buffers
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
      const target = Math.floor((idx.getCount() * ratio) / 3) * 3;
      const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), pos.getArray(), 3, null, target, 0.05);
      idx.setArray(new Uint32Array(out));
    }
    await doc.transform(prune());
  }
  const after = count();
  // keep texture URIs pointing to the shared original textures
  const out = path.join(dir, `${id}_rt.gltf`);
  const json = await io.writeJSON(doc);
  json.json.buffers.forEach((b) => (b.uri = `${id}_rt.bin`));
  const [bin] = Object.values(json.resources).filter((r, i) => Object.keys(json.resources)[i].endsWith('.bin'));
  fs.writeFileSync(path.join(dir, `${id}_rt.bin`), Buffer.from(bin));
  fs.writeFileSync(out, JSON.stringify(json.json));
  console.log(id, Math.round(before), '->', Math.round(after));
}
