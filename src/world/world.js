// Loads assets and assembles the whole environment.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WORLD, heightAt, lakeDist, normalAt } from './heightfield.js';
import { buildTerrain, bakeWorldData, coverageAt, pathMask } from './terrain.js';
import { Scatter, Colliders } from './scatter.js';
import { createTreeKinds, windify } from './trees.js';
import { mulberry32, smoothstep } from '../core/noise.js';
import { posHash } from './props.js';
import { Flora } from './flora.js';

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
    this.buildCanopy();
    onStep?.('岩と下草を配置中…');
    this.buildRocksAndPlants(models, textures);
    onStep?.('草花と林床を配置中…');
    // ?noflora (QA): A/B the cost of the lane-C ground detail
    if (!(typeof location !== 'undefined' && /[?&]noflora/.test(location.search))) this.flora = new Flora(this).build();
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
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), eul = new THREE.Euler();
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
      q.setFromEuler(eul.set((rnd() - 0.5) * 0.06, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.06));
      p.set(x, h - 0.15, z); s.set(sc, sc * (0.9 + rnd() * 0.2), sc);
      m.compose(p, q, s);
      const c = new THREE.Color().setHSL(0.25 + (rnd() - 0.5) * 0.05, 0.25 + rnd() * 0.2, 0.45 + rnd() * 0.2);
      this.scatter.add(kind, m, c.multiplyScalar(1.6));
      const variant = kinds.variants.find((v) => v.name === kind);
      this.colliders.add(x, z, variant.radius * sc + 0.1, 'tree');
      (this.treeSpots || (this.treeSpots = [])).push({ x, z, r: (kind.startsWith('birch') ? 3.2 : 3.8) * sc });
      placed++;
    }
    this.treeCount = placed;
  }

  // canopy density (0..1) on a 2m grid from the placed trees: forest floor darkens / turns to needle litter and
  // the grass thins out under the crowns (before, lush meadow grass grew right up to every spruce trunk)
  buildCanopy() {
    const res = 360, size = WORLD.size, cs = size / res, g = new Float32Array(res * res);
    for (const t of this.treeSpots || []) {
      const r = t.r, i0 = Math.max(0, Math.floor((t.x - r + size / 2) / cs)), i1 = Math.min(res - 1, Math.ceil((t.x + r + size / 2) / cs));
      const j0 = Math.max(0, Math.floor((t.z - r + size / 2) / cs)), j1 = Math.min(res - 1, Math.ceil((t.z + r + size / 2) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * cs - size / 2 - t.x, dz = (j + 0.5) * cs - size / 2 - t.z, d = Math.hypot(dx, dz) / r;
        if (d < 1) g[j * res + i] += (1 - d * d) * 0.6;
      }
    }
    for (let i = 0; i < g.length; i++) g[i] = Math.min(1, g[i]);
    this.canopy = { g, res, cs };
    // grass density (G) / forest floor (B) in the baked world data
    const wd = this.worldData, d = wd.data;
    for (let j = 0; j < wd.res; j++) for (let i = 0; i < wd.res; i++) {
      const x = (i / (wd.res - 1) - 0.5) * size, z = (j / (wd.res - 1) - 0.5) * size, c = this.canopyAt(x, z), k = (j * wd.res + i) * 4;
      d[k + 1] *= 1 - 0.75 * c; d[k + 2] = Math.max(d[k + 2], c * 0.9);
    }
    wd.tex.needsUpdate = true;
    // terrain splat: shift grass weight to the forest-floor layer under the canopy
    const geo = this.terrain.geometry, sp = geo.attributes.splat, pos = geo.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const c = this.canopyAt(pos.getX(i), pos.getZ(i)) * 0.85; if (c < 0.01) continue;
      const gr = sp.getX(i) * c; sp.setX(i, sp.getX(i) - gr); sp.setY(i, sp.getY(i) + gr);
    }
    sp.needsUpdate = true;
  }

  canopyAt(x, z) {
    const C = this.canopy; if (!C) return 0;
    const u = (x + WORLD.size / 2) / C.cs - 0.5, v = (z + WORLD.size / 2) / C.cs - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j, r = C.res;
    if (i < 0 || j < 0 || i >= r - 1 || j >= r - 1) return 0;
    const a = C.g[j * r + i], b = C.g[j * r + i + 1], c = C.g[(j + 1) * r + i], d = C.g[(j + 1) * r + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
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

    // edible mushrooms you can pick: chanterelles (golden funnels with decurrent false gills) and porcini (fat
    // club stem with net pattern, bun-shaped brown cap, pale pore layer). Deliberately NOT the red fly agaric of
    // the decorative flora, so what you can eat is visually distinct from what you shouldn't.
    // (each spawn builds its own geometry because interactions.js disposes them on pickup)
    const chantMat = new THREE.MeshStandardMaterial({ color: 0xe8a23a, roughness: 0.6, vertexColors: true });
    const porciniCap = new THREE.MeshPhysicalMaterial({ color: 0x7a4722, roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.6 });
    const porciniStem = new THREE.MeshStandardMaterial({ color: 0xe2d6bc, roughness: 0.85, vertexColors: true });
    const porciniPores = new THREE.MeshStandardMaterial({ color: 0xd8d09a, roughness: 0.9 });
    const bedMat = new THREE.MeshStandardMaterial({ color: 0x3c4a1e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
    const chanterelle = (s) => {
      // lathe profile: thin stem flaring into a wavy funnel cap
      const pts = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.006 + Math.pow(t, 2.2) * 0.05 + t * 0.006, t * 0.075)); }
      pts.push(new THREE.Vector2(0.066, 0.078), new THREE.Vector2(0.05, 0.072), new THREE.Vector2(0.001, 0.066));
      const g = new THREE.LatheGeometry(pts, 20);
      const p = g.attributes.position, c = new Float32Array(p.count * 3), ph = rnd() * 6.28;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
        const wave = 1 + 0.16 * Math.sin(a * 5 + ph) * Math.min(1, y / 0.07); // wavy, lobed rim
        const ridge = y > 0.03 && y < 0.074 ? 1 - 0.18 * Math.max(0, Math.sin(a * 26)) : 1; // false gills underneath
        p.setXYZ(i, x * wave, y + Math.sin(a * 3 + ph) * 0.006 * (r / 0.06), z * wave);
        const k = ridge * (0.85 + 0.15 * (y / 0.08));
        c[i * 3] = k; c[i * 3 + 1] = k * 0.95; c[i * 3 + 2] = k * 0.85;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.scale(s, s, s); g.computeVertexNormals();
      return new THREE.Mesh(g, chantMat);
    };
    const porcini = (s) => {
      const o = new THREE.Group();
      const sp = [];
      for (let i = 0; i <= 8; i++) { const t = i / 8; sp.push(new THREE.Vector2(0.03 + Math.sin(t * Math.PI * 0.8) * 0.014 - t * 0.012, t * 0.085)); }
      const sg = new THREE.LatheGeometry(sp, 14);
      const p = sg.attributes.position, c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)), y = p.getY(i); const net = 0.88 + 0.12 * Math.abs(Math.sin(a * 11) * Math.sin(y * 260)); c[i * 3] = net; c[i * 3 + 1] = net * 0.97; c[i * 3 + 2] = net * 0.9; }
      sg.setAttribute('color', new THREE.BufferAttribute(c, 3)); sg.scale(s, s, s); sg.computeVertexNormals();
      const cap = new THREE.SphereGeometry(0.058 * s, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.52); cap.scale(1, 0.62, 1);
      const cp = cap.attributes.position; for (let i = 0; i < cp.count; i++) { const a = Math.atan2(cp.getZ(i), cp.getX(i)); const k = 1 + 0.04 * Math.sin(a * 3 + s * 7); cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); }
      cap.computeVertexNormals(); cap.translate(0, 0.078 * s, 0);
      const pores = new THREE.CircleGeometry(0.056 * s, 18); pores.rotateX(Math.PI / 2); pores.translate(0, 0.079 * s, 0);
      o.add(new THREE.Mesh(sg, porciniStem), new THREE.Mesh(cap, porciniCap), new THREE.Mesh(pores, porciniPores));
      return o;
    };
    const mushroomGeo = () => {
      const g = new THREE.Group();
      const isChant = rnd() < 0.55, n = isChant ? 3 + ((rnd() * 4) | 0) : 1 + ((rnd() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const s = (isChant ? 0.7 : 0.75) + rnd() * 0.6;
        const o = isChant ? chanterelle(s) : porcini(s);
        o.position.set((rnd() - 0.5) * 0.24, -0.004, (rnd() - 0.5) * 0.24);
        o.rotation.set((rnd() - 0.5) * 0.25, rnd() * 6.28, (rnd() - 0.5) * 0.25);
        o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
        g.add(o);
      }
      // a few fallen needles / moss under the cluster so it sits in the litter instead of on it
      const bed = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), bedMat);
      bed.rotation.x = -Math.PI / 2; bed.position.y = 0.006; bed.receiveShadow = true; g.add(bed);
      return g;
    };
    const spawnMushroom = () => {
      for (let k = 0; k < 60; k++) {
        const a = rnd() * Math.PI * 2, rr = 20 + rnd() * 90;
        const x = WORLD.camp.x + Math.cos(a) * rr, z = WORLD.camp.z + Math.sin(a) * rr;
        const h = heightAt(x, z);
        if (h < 1 || coverageAt(x, z, h, 0)[1] < 0.5 || !this.isCampClear(x, z, 0)) continue;
        if (this.colliders.near(x, z, 0.25).length) continue; // spawned inside tree trunks / boulders
        const g = mushroomGeo(); g.position.set(x, h, z);
        const n = normalAt(x, z); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], n[1], n[2])); // follow the slope
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
    // one shared geometry + one InstancedMesh per bush (was 26 separate meshes/geometries per bush = 312 draw
    // calls, x2 with shadows, for the 12 bushes)
    const berryGeo = new THREE.SphereGeometry(0.03, 8, 6), bm4 = new THREE.Matrix4();
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
        const berries = new THREE.InstancedMesh(berryGeo, berryMat, 26);
        for (let b = 0; b < 26; b++) {
          const v = new THREE.Vector3(rnd() - 0.5, rnd() * 0.6, rnd() - 0.5).normalize().multiplyScalar(0.48);
          berries.setMatrixAt(b, bm4.makeTranslation(v.x, 0.35 + v.y * 0.8, v.z));
        }
        berries.computeBoundingSphere();
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

  // lodBias (lens): at 20x the narrow FOV makes far objects big on screen -> LOD/cull distances are scaled up
  update(dt, cam, lodBias = 1) {
    this.U.uTime.value += dt;
    // gusty wind
    const t = this.U.uTime.value;
    const g = 0.7 + 0.35 * Math.sin(t * 0.23) + 0.2 * Math.sin(t * 0.61 + 1);
    this.U.uWind.value.set(0.85 * g, 0.4 * g);
    let fr = null;
    if (lodBias > 1) {
      fr = this._fr || (this._fr = new THREE.Frustum()); const m = this._frm || (this._frm = new THREE.Matrix4());
      cam.updateMatrixWorld(); fr.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    }
    this.scatter.update(cam.position, lodBias, fr);
    this.flora?.update(cam.position, lodBias, fr);
  }
}
