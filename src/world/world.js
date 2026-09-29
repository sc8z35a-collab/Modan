// Loads assets and assembles the whole environment.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WORLD, heightAt, lakeDist, normalAt } from './heightfield.js';
import { buildTerrain, bakeWorldData, coverageAt, pathMask } from './terrain.js';
import { Scatter, Colliders } from './scatter.js';
import { createTreeKinds, windify } from './trees.js';
import { mulberry32, smoothstep } from '../core/noise.js';
import { posHash } from './props.js';

// resolve assets against the deploy base (works at / and at a sub-path like /Modan/)
// VITE_ASSET_BASE lets the Pages build (tools/build-pages.mjs) load the big textures/models straight from
// ../public/ instead of shipping a second 21MB copy
const BASE = import.meta.env?.VITE_ASSET_BASE || import.meta.env?.BASE_URL || './';
const TEX_IDS = ['aerial_grass_rock', 'forest_ground_04', 'rocky_terrain_02', 'coast_sand_rocks_02', 'pine_bark', 'bark_brown_02', 'brown_planks_05'];
const MODEL_IDS = ['boulder_01', 'rock_moss_set_01', 'tree_stump_01', 'dead_tree_trunk', 'fern_02', 'shrub_01', 'dry_branches_medium_01', 'namaqualand_stones_01'];

export async function loadAssets(renderer, onProgress, texMax = 0) {
  const manager = new THREE.LoadingManager();
  manager.onProgress = (_u, l, t) => onProgress?.(l / t);
  const tl = new THREE.TextureLoader(manager);
  const gl = new GLTFLoader(manager);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const textures = {};
  const jobs = [];
  for (const id of TEX_IDS) {
    textures[id] = {};
    for (const k of ['diff', 'nor', 'arm']) {
      jobs.push(tl.loadAsync(`${BASE}assets/textures/${id}/${k}.jpg`).then((t) => {
        if (texMax && t.image.width > texMax) {
          const c = document.createElement('canvas'); c.width = c.height = texMax;
          c.getContext('2d').drawImage(t.image, 0, 0, texMax, texMax); t.image = c;
        }
        if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.RepeatWrapping;
        textures[id][k] = t;
      }));
    }
  }
  const models = {};
  for (const id of MODEL_IDS) {
    jobs.push(gl.loadAsync(`${BASE}assets/models/${id}/${id}_rt.gltf`).then((g) => { models[id] = g.scene; }));
  }
  await Promise.all(jobs);
  return { textures, models };
}

// Extract the mesh parts of a gltf scene (baked to world transform of the scene root)
function partsOf(root, filterName) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (filterName && !filterName(o.name)) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
    out.push({ geo: g, mat: o.material, name: o.name });
  });
  return out;
}

export class World {
  constructor(renderer, scene, assets, quality) {
    this.renderer = renderer; this.scene = scene; this.assets = assets; this.q = quality;
    this.colliders = new Colliders(8);
    this.scatter = new Scatter(scene, 64);
    this.U = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.35) }, uTentGlow: { value: 0 } };
    this.pickups = [];     // interactive collectibles
    this.choppables = [];  // dead trunks / stumps you can chop
  }

  build(onStep) {
    const { textures, models } = this.assets;
    onStep?.('地形を生成中…');
    this.worldData = bakeWorldData(512);
    const t = buildTerrain(textures, this.renderer.capabilities.getMaxAnisotropy());
    this.terrain = t.mesh; this.noiseTex = t.noiseTex; this.terrainU = t.uniforms;
    this.scene.add(this.terrain);

    onStep?.('森を育てています…');
    this.buildTrees(textures);
    onStep?.('岩と下草を配置中…');
    this.buildRocksAndPlants(models, textures);
    this.scatter.build();
  }

  // ---------- placement helpers
  isCampClear(x, z, pad = 0) {
    const C = WORLD.camp;
    if (Math.hypot(x - C.x, z - C.z) < C.r + pad) return false;
    if (pathMask(x, z) > 0.05) return false;
    // dock corridor
    if (x > -12 && x < -2 && z < -8 && z > -40) return false; // dock corridor now reaches the dock's far end
    return true;
  }

  buildTrees(textures) {
    const kinds = createTreeKinds(textures, this.U, this.q.trees);
    this.treeKinds = kinds;
    for (const v of kinds.variants) this.scatter.defineKind(v.name, v.lods, { cullDist: 520 });
    const rnd = mulberry32(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const R = 330;
    const attempts = Math.round(26000 * this.q.trees);
    let placed = 0;
    for (let i = 0; i < attempts; i++) {
      const x = WORLD.camp.x + (rnd() * 2 - 1) * R, z = WORLD.camp.z + (rnd() * 2 - 1) * R;
      if (Math.abs(x) > WORLD.size / 2 - 10 || Math.abs(z) > WORLD.size / 2 - 10) continue;
      const h = heightAt(x, z);
      if (h < 0.9 || lakeDist(x, z) < 4) continue;
      if (!this.isCampClear(x, z, 3)) continue;
      const n = normalAt(x, z);
      const slope = 1 - n[1];
      if (slope > 0.35) continue;
      const cov = coverageAt(x, z, h, slope);
      // forest density: dense in forest mask, sparse in meadows, clustered
      const dens = cov[1] * 0.95 + cov[0] * 0.06;
      if (rnd() > dens) continue;
      // distance thinning for performance beyond 200m
      const dc = Math.hypot(x - WORLD.camp.x, z - WORLD.camp.z);
      if (dc > 200 && rnd() > 0.55) continue;
      let kind;
      const r = rnd();
      const nearWater = lakeDist(x, z) < 25;
      if (nearWater && r < 0.35) kind = 'birch' + ((rnd() * 2) | 0);
      else if (r < 0.66) kind = 'spruce' + ((rnd() * 4) | 0);
      else if (r < 0.92) kind = 'pine' + ((rnd() * 3) | 0);
      else kind = 'birch' + ((rnd() * 2) | 0);
      const sc = 0.75 + rnd() * 0.55;
      q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.06, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.06));
      p.set(x, h - 0.15, z); s.set(sc, sc * (0.9 + rnd() * 0.2), sc);
      m.compose(p, q, s);
      const c = new THREE.Color().setHSL(0.25 + (rnd() - 0.5) * 0.05, 0.25 + rnd() * 0.2, 0.45 + rnd() * 0.2);
      this.scatter.add(kind, m, c.multiplyScalar(1.6));
      const variant = kinds.variants.find((v) => v.name === kind);
      this.colliders.add(x, z, variant.radius * sc + 0.1, 'tree');
      placed++;
    }
    this.treeCount = placed;
  }

  defineModelKind(name, root, lodDists, opts = {}) {
    const parts = partsOf(root, opts.filter);
    for (const pt of parts) {
      pt.castShadow = opts.castShadow ?? true;
      if (opts.wind) pt.mat = windify(pt.mat.clone(), this.U, opts.wind, true);
      if (opts.alpha) { pt.mat.alphaTest = 0.5; pt.mat.alphaToCoverage = true; pt.mat.side = THREE.DoubleSide; }
      pt.mat.envMapIntensity = 0.7;
    }
    const lods = [{ dist: lodDists[0], parts }];
    this.scatter.defineKind(name, lods, { cullDist: lodDists[0] });
    return parts;
  }

  buildRocksAndPlants(models, textures) {
    const rnd = mulberry32(555);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const place = (name, count, R, opts) => {
      let n = 0;
      for (let i = 0; i < count * 8 && n < count; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
        const x = WORLD.camp.x + Math.cos(a) * rr + (opts.ox || 0), z = WORLD.camp.z + Math.sin(a) * rr + (opts.oz || 0);
        const h = heightAt(x, z);
        if (opts.filter && !opts.filter(x, z, h)) continue;
        if (!this.isCampClear(x, z, opts.pad ?? 1)) continue;
        const sc = opts.scale[0] + rnd() * (opts.scale[1] - opts.scale[0]);
        const n3 = normalAt(x, z);
        const up = new THREE.Vector3(...n3);
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), opts.align ? up : new THREE.Vector3(0, 1, 0));
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2));
        p.set(x, h - (opts.sink || 0) * sc, z); s.setScalar(sc);
        m.compose(p, q, s);
        this.scatter.add(name, m);
        if (opts.collide) this.colliders.add(x, z, opts.collide * sc, name);
        n++;
      }
    };
    this.defineModelKind('boulder', models.boulder_01, [260]);
    this.defineModelKind('mossrocks', models.rock_moss_set_01, [140]);
    this.defineModelKind('stones', models.namaqualand_stones_01, [80], { castShadow: false });
    this.defineModelKind('fern', models.fern_02, [55], { wind: 0.5, alpha: true, castShadow: false });
    this.defineModelKind('shrub', models.shrub_01, [60], { wind: 0.6, alpha: true });
    this.defineModelKind('stump', models.tree_stump_01, [120]);

    const land = (x, z, h) => h > 0.6;
    place('boulder', 70, 240, { scale: [0.6, 2.4], sink: 0.3, collide: 1.1, filter: land, align: true });
    // shore boulders around the dock cove (the old offset centred them on the camp ~30m from water -> 0 placed)
    place('boulder', 12, 24, { ox: -14, oz: -40, scale: [0.5, 1.2], sink: 0.2, collide: 1.1, filter: (x, z) => Math.abs(lakeDist(x, z)) < 5 });
    place('mossrocks', 90, 180, { scale: [0.8, 1.8], sink: 0.1, collide: 0.6, filter: land, align: true });
    place('stones', 160, 120, { scale: [0.7, 1.4], filter: (x, z, h) => h > 0.1, align: true, pad: 0 });
    place('fern', Math.round(700 * this.q.grass + 150), 110, { scale: [0.8, 1.6], filter: (x, z, h) => h > 0.8 && coverageAt(x, z, h, 0)[1] > 0.4, align: true });
    place('shrub', 10, 70, { scale: [0.7, 1.1], filter: land, collide: 0.5 });
    place('stump', 26, 110, { scale: [0.8, 1.2], sink: 0.05, collide: 0.45, filter: land });
  }

  // interactive: firewood branches, dead trunks to chop, mushrooms, berries
  buildInteractables(models, textures) {
    const rnd = mulberry32(777);
    const branchRoot = models.dry_branches_medium_01;
    const branchParts = partsOf(branchRoot);
    const makeBranch = (i) => {
      const pt = branchParts[i % branchParts.length];
      const mesh = new THREE.Mesh(pt.geo, pt.mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      // recenter
      pt.geo.computeBoundingBox();
      const c = pt.geo.boundingBox.getCenter(new THREE.Vector3());
      const g = new THREE.Group(); mesh.position.set(-c.x, -pt.geo.boundingBox.min.y, -c.z); g.add(mesh);
      return g;
    };
    const spawnBranch = () => {
      for (let k = 0; k < 50; k++) {
        const a = rnd() * Math.PI * 2, rr = 12 + rnd() * 70;
        const x = WORLD.camp.x + Math.cos(a) * rr, z = WORLD.camp.z + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 0.8 || !this.isCampClear(x, z, 0)) continue;
        const g = makeBranch((rnd() * 10) | 0);
        g.position.set(x, h, z); g.rotation.y = rnd() * 6.28; g.scale.setScalar(0.9 + rnd() * 0.4);
        this.scene.add(g);
        this.pickups.push({ type: 'wood', obj: g, pos: g.position, label: '薪を拾う', radius: 1.9 });
        return;
      }
    };
    for (let i = 0; i < 40; i++) spawnBranch();
    this.spawnBranch = spawnBranch;

    // mushrooms (procedural, glowing slightly at night? no — realistic porcini/chanterelle)
    const capMat = new THREE.MeshStandardMaterial({ color: 0x8a4a22, roughness: 0.55 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.8 });
    const mushroomGeo = () => {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = 0.6 + rnd() * 0.6;
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.1 * s, 10), stemMat);
        stem.position.y = 0.05 * s;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
        cap.scale.y = 0.6; cap.position.y = 0.095 * s;
        const o = new THREE.Group(); o.add(stem, cap); o.position.set((rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2);
        o.rotation.z = (rnd() - 0.5) * 0.3;
        stem.castShadow = cap.castShadow = true;
        g.add(o);
      }
      return g;
    };
    const spawnMushroom = () => {
      for (let k = 0; k < 60; k++) {
        const a = rnd() * Math.PI * 2, rr = 20 + rnd() * 90;
        const x = WORLD.camp.x + Math.cos(a) * rr, z = WORLD.camp.z + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 1 || coverageAt(x, z, h, 0)[1] < 0.5 || !this.isCampClear(x, z, 0)) continue;
        const g = mushroomGeo(); g.position.set(x, h, z);
        this.scene.add(g);
        this.pickups.push({ type: 'mushroom', obj: g, pos: g.position, label: 'キノコを採る', radius: 1.6 });
        return;
      }
    };
    for (let i = 0; i < 18; i++) spawnMushroom();
    this.spawnMushroom = spawnMushroom;

    // berry bushes (re-harvestable)
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2c4a1c, roughness: 0.8 });
    const berryMat = new THREE.MeshPhysicalMaterial({ color: 0x3a1a5a, roughness: 0.25, clearcoat: 0.8 });
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, rr = 14 + rnd() * 60;
        const x = WORLD.camp.x + Math.cos(a) * rr, z = WORLD.camp.z + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 1 || !this.isCampClear(x, z, 1)) continue;
        const g = new THREE.Group();
        const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 3), leafMat);
        const bp = bush.geometry.attributes.position;
        const seed = rnd() * 100; // per-bush variation, but per-POSITION displacement (no cracks)
        for (let j = 0; j < bp.count; j++) {
          const x = bp.getX(j), y = bp.getY(j), z = bp.getZ(j);
          const f = 0.75 + posHash(+x.toFixed(4), +y.toFixed(4), +z.toFixed(4), seed) * 0.45;
          bp.setXYZ(j, x * f, y * f * 0.8, z * f);
        }
        bush.geometry.computeVertexNormals();
        bush.position.y = 0.35; bush.castShadow = true; g.add(bush);
        const berries = new THREE.Group();
        for (let b = 0; b < 26; b++) {
          const v = new THREE.Vector3(rnd() - 0.5, rnd() * 0.6, rnd() - 0.5).normalize().multiplyScalar(0.48);
          const bm = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), berryMat);
          bm.position.set(v.x, 0.35 + v.y * 0.8, v.z); berries.add(bm);
        }
        g.add(berries);
        g.position.set(x, h, z);
        this.scene.add(g);
        this.colliders.add(x, z, 0.45, 'bush');
        this.pickups.push({ type: 'berry', obj: g, berries, pos: g.position, label: 'ベリーを摘む', radius: 1.9, regrow: 0 });
        break;
      }
    }

    // dead trunks you can chop for lots of wood
    const trunkParts = partsOf(models.dead_tree_trunk);
    for (let i = 0; i < 7; i++) {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2, rr = 16 + rnd() * 55;
        const x = WORLD.camp.x + Math.cos(a) * rr, z = WORLD.camp.z + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 1 || !this.isCampClear(x, z, 2) || this.colliders.near(x, z, 3).length) continue;
        const g = new THREE.Group();
        for (const pt of trunkParts) { const mm = new THREE.Mesh(pt.geo, pt.mat); mm.castShadow = mm.receiveShadow = true; g.add(mm); }
        g.position.set(x, h - 0.05, z); g.rotation.y = rnd() * 6.28;
        this.scene.add(g);
        const box = new THREE.Box3().setFromObject(g);
        // the log is ~3m long along its local X axis: one 0.5m circle at the centre let the player walk
        // straight through both ends -> a chain of circles along the log
        const ry = g.rotation.y, ax = Math.cos(ry), az = -Math.sin(ry);
        const col = [-1.2, -0.6, 0, 0.6, 1.2].map((o) => this.colliders.add(x + ax * o, z + az * o, 0.35, 'trunk'));
        this.choppables.push({ type: 'trunk', obj: g, pos: g.position, label: '倒木を割る', radius: 2.6, hp: 5, col, size: box.getSize(new THREE.Vector3()) });
        break;
      }
    }
  }

  surfaceAt(x, z, water) {
    if (water > 0.05) return 'water';
    const h = heightAt(x, z);
    const c = coverageAt(x, z, h, 0);
    if (c[3] > 0.5) return 'sand';
    if (c[1] > 0.5 || pathMask(x, z) > 0.5) return 'dirt';
    return 'grass';
  }

  update(dt, cam) {
    this.U.uTime.value += dt;
    // gusty wind
    const t = this.U.uTime.value;
    const g = 0.7 + 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1);
    this.U.uWind.value.set(0.85 * g, 0.4 * g);
    this.scatter.update(cam.position);
  }
}
