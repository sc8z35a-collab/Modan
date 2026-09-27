// Chunked instancing with per-chunk LOD + frustum culling, plus a collision spatial hash.
import * as THREE from 'three';

export class Scatter {
  constructor(scene, cell = 56) {
    this.scene = scene;
    this.cell = cell;
    this.kinds = new Map();
    this.chunks = [];
  }

  // lods: [{ dist, parts: [{geo, mat, castShadow}] }] sorted by dist ascending (last lod may use Infinity)
  defineKind(name, lods, { cullDist = Infinity } = {}) {
    this.kinds.set(name, { lods, cullDist, items: new Map() });
  }

  add(name, matrix, color) {
    const k = this.kinds.get(name);
    const e = matrix.elements;
    const key = Math.floor(e[12] / this.cell) + ',' + Math.floor(e[14] / this.cell);
    if (!k.items.has(key)) k.items.set(key, []);
    k.items.get(key).push({ m: matrix.clone(), c: color });
  }

  build() {
    for (const [name, k] of this.kinds) {
      for (const [key, items] of k.items) {
        const [cx, cz] = key.split(',').map(Number);
        const chunk = {
          name, center: new THREE.Vector3((cx + 0.5) * this.cell, 0, (cz + 0.5) * this.cell),
          lods: [], cullDist: k.cullDist, cur: -2,
        };
        let ysum = 0; items.forEach((it) => (ysum += it.m.elements[13])); chunk.center.y = ysum / items.length;
        for (const lod of k.lods) {
          const group = [];
          for (const part of lod.parts) {
            const im = new THREE.InstancedMesh(part.geo, part.mat, items.length);
            items.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            im.computeBoundingSphere();
            im.castShadow = !!part.castShadow; im.receiveShadow = true;
            im.visible = false;
            im.name = name;
            this.scene.add(im);
            group.push(im);
          }
          chunk.lods.push({ dist: lod.dist, meshes: group });
        }
        this.chunks.push(chunk);
      }
    }
  }

  update(camPos, lodBias = 1) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.center.x - camPos.x, c.center.z - camPos.z) - this.cell * 0.7;
      let idx = -1;
      if (d < c.cullDist * lodBias) {
        idx = c.lods.length - 1;
        for (let i = 0; i < c.lods.length; i++) if (d < c.lods[i].dist * lodBias) { idx = i; break; }
      }
      if (idx === c.cur) continue;
      c.lods.forEach((l, i) => l.meshes.forEach((m) => (m.visible = i === idx)));
      c.cur = idx;
    }
  }
}

export class Colliders {
  static PAD = 0.6; // >= max query radius used by resolve()
  constructor(cell = 8) { this.cell = cell; this.map = new Map(); this.list = []; }
  key(x, z) { return Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell); }
  add(x, z, r, tag) {
    const c = { x, z, r, tag };
    this.list.push(c);
    // register with padding: resolve() only looks up the player's own cell, so a collider in the neighbouring
    // cell was ignored and the player walked through trees / rocks sitting on a cell border
    const pad = r + Colliders.PAD;
    const x0 = Math.floor((x - pad) / this.cell), x1 = Math.floor((x + pad) / this.cell);
    const z0 = Math.floor((z - pad) / this.cell), z1 = Math.floor((z + pad) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i + ',' + j; if (!this.map.has(k)) this.map.set(k, []); this.map.get(k).push(c);
    }
    return c;
  }
  remove(c) {
    if (!c) return;
    for (const arr of this.map.values()) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
    const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); // list kept stale entries
  }
  // push point out of colliders; returns corrected [x,z]
  resolve(x, z, pr = 0.35) {
    for (let it = 0; it < 2; it++) {
      const arr = this.map.get(this.key(x, z));
      if (!arr) break;
      for (const c of arr) {
        const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + pr;
        if (d < m) {
          if (d > 1e-5) { x = c.x + (dx / d) * m; z = c.z + (dz / d) * m; }
          else x = c.x + m; // exactly at the centre: previously stayed stuck inside
        }
      }
    }
    return [x, z];
  }
  // query every cell overlapped by the radius (only the centre cell was checked -> trunks spawned inside trees)
  near(x, z, r) {
    const out = [], seen = new Set();
    const x0 = Math.floor((x - r) / this.cell), x1 = Math.floor((x + r) / this.cell);
    const z0 = Math.floor((z - r) / this.cell), z1 = Math.floor((z + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const arr = this.map.get(i + ',' + j); if (!arr) continue;
      for (const c of arr) if (!seen.has(c) && Math.hypot(x - c.x, z - c.z) < r + c.r) { seen.add(c); out.push(c); }
    }
    return out;
  }
}
