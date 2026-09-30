// Lane B prop viewer: renders only the camp (terrain patch + props) so close-up detail can be checked
// quickly under SwiftShader. URL: /tools/b/propview.html?cam=x,y,z&look=x,y,z&night=1&w=900&h=500
import * as THREE from 'three';
import { WORLD, heightAt } from '../../src/world/heightfield.js';
import * as P from '../../src/world/props.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 900), H = +(q.get('h') || 500), night = q.has('night');
const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.AgXToneMapping; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(night ? 0x05070c : 0x9fb8cc);
const cam = new THREE.PerspectiveCamera(+(q.get('fov') || 55), W / H, 0.02, 200);
const hemi = new THREE.HemisphereLight(night ? 0x223044 : 0xcfe3ff, night ? 0x0a0806 : 0x5a4a30, night ? 0.25 : 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(night ? 0x8899cc : 0xfff1dc, night ? 0.15 : 2.6); sun.position.set(20, 30, 12); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
const C = WORLD.camp; sun.target.position.set(C.x, heightAt(C.x, C.z), C.z); sun.position.add(sun.target.position); scene.add(sun, sun.target);
const tl = new THREE.TextureLoader();
const ids = ['aerial_grass_rock', 'forest_ground_04', 'rocky_terrain_02', 'bark_brown_02', 'brown_planks_05', 'pine_bark', 'coast_sand_rocks_02'];
const textures = {};
await Promise.all(ids.flatMap((id) => { textures[id] = {}; return ['diff', 'nor', 'arm'].map((k) => tl.loadAsync(`../../public/assets/textures/${id}/${k}.jpg`).then((t) => { if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; textures[id][k] = t; })); }));
// terrain patch 40x40m
const tg = new THREE.PlaneGeometry(40, 40, 200, 200); tg.rotateX(-Math.PI / 2);
const tp = tg.attributes.position; for (let i = 0; i < tp.count; i++) { const x = tp.getX(i) + C.x, z = tp.getZ(i) + C.z; tp.setXYZ(i, x, heightAt(x, z), z); } tg.computeVertexNormals();
function uvS(g) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 14, uv.getY(i) * 14); } uvS(tg);
const gt = textures.forest_ground_04; scene.add(Object.assign(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: gt.diff, normalMap: gt.nor, roughness: 1 })), { receiveShadow: true }));
const U = { uTime: { value: 0 }, uTentGlow: { value: night ? 0.5 : 0 }, uWind: { value: new THREE.Vector2(0.8, 0.35) } };
const colliders = { list: [], add(x, z, r, tag) { const c = { x, z, r, tag }; this.list.push(c); return c; } };
// mirror of main.js buildCamp placement
const put = (o, x, z, ry = 0, yo = 0) => { o.position.set(x, heightAt(x, z) + yo, z); o.rotation.y = ry; scene.add(o); return o; };
const fx = C.x, fz = C.z, tx = textures;
put(P.buildFireRing(tx), fx, fz); const logs = put(P.buildFireLogs(tx), fx, fz);
const trip = put(P.buildTripod(), fx, fz); const k = P.buildKettle(); k.position.set(0, 0.81, 0); trip.add(k); if (P.buildFireLogs && q.get('fuel')) logs.userData.setFuel?.(+q.get('fuel'));
const tx0 = C.x - 6.5, tz0 = C.z + 3.5; const tent = put(P.buildTent(U), tx0, tz0, 0.9, 0.02);
for (const [x, z, rr] of [[fx + 2.4, fz + 0.6, 1.4], [fx - 0.6, fz - 2.5, 0.2]]) put(P.buildLogSeat(tx), x, z, rr);
put(P.buildChair(), fx + 0.4, fz + 2.6, Math.atan2(0.4, 2.6));
put(P.buildWoodPile(tx), C.x - 3.5, C.z - 2.2, 0.6);
const lanterns = [put(P.buildLantern(), C.x - 4.4, C.z + 5.8)];
if (P.buildTable) { const t = put(P.buildTable(tx), C.x + 4.2, C.z + 4.2, -0.5); if (t.userData.lantern) lanterns.push(t.userData.lantern); }
if (P.settleToGround) P.settleToGround(tent, heightAt);
{ const pm = new THREE.MeshStandardMaterial({ map: tx.bark_brown_02.diff, roughness: 1 }); for (const [px, pz] of [[tx0 + 0.9, tz0 - 1.9], [C.x + 4.9, C.z + 5.6]]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.5, 10), pm); pole.position.set(px, heightAt(px, pz) + 1.25, pz); pole.castShadow = true; scene.add(pole); } }
// water plane + boat (for q.has('boat')): boat at camp +(0,0,-6) floating at waterline
if (q.has('boat') && P.buildRowboat) { const bt = P.buildRowboat(tx); const by = heightAt(C.x, C.z) + 0.6; bt.position.set(C.x, by, C.z - 6); bt.rotation.y = 0.6; scene.add(bt); const wm = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a4a55, roughness: 0.1, transparent: true, opacity: 0.75 })); wm.position.set(C.x, by - 0.26, C.z - 6); scene.add(wm); }
// dock + boat exactly like main.js (for dock-kit / boat checks: dock=1 moves the camera relative to the dock end)
let dockG = null;
if (q.has('dock')) {
  const { PATH_PTS } = await import('../../src/world/terrain.js');
  const [px0, pz0] = PATH_PTS[PATH_PTS.length - 1]; const ddx = -Math.sin(0.12), ddz = -Math.cos(0.12);
  let ds = 0; while (ds < 12 && heightAt(px0 + ddx * ds, pz0 + ddz * ds) > 0.62) ds += 0.1;
  const ex = px0 + ddx * ds, ez = pz0 + ddz * ds; dockG = P.buildDock(tx, 16); dockG.position.set(ex, 0.55, ez); dockG.rotation.y = 0.12; scene.add(dockG);
  const end = new THREE.Vector3(ex, 0.55, ez).addScaledVector(new THREE.Vector3(ddx, 0, ddz), 14.8);
  const bt = P.buildRowboat(tx); bt.position.copy(end).add(new THREE.Vector3(2.1, 0, 2)); bt.rotation.y = 0.2; bt.position.y = 0.26; scene.add(bt);
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x24404a, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.8 })); wm.position.set(end.x, 0, end.z); scene.add(wm);
  window.__dockEnd = end;
  sun.target.position.copy(end); sun.position.set(end.x + 20, 30, end.z + 12);
  // terrain patch around the dock
  const tg2 = new THREE.PlaneGeometry(40, 40, 120, 120); tg2.rotateX(-Math.PI / 2); const p2 = tg2.attributes.position; for (let i = 0; i < p2.count; i++) { const x = p2.getX(i) + ex, z = p2.getZ(i) + ez + 5; p2.setXYZ(i, x, heightAt(x, z), z); } tg2.computeVertexNormals(); uvS(tg2);
  scene.add(Object.assign(new THREE.Mesh(tg2, new THREE.MeshStandardMaterial({ map: textures.coast_sand_rocks_02.diff, roughness: 1 })), { receiveShadow: true }));
}
let details = null;
if (q.get('details') !== '0') {
  try { const m = await import('../../src/world/campdetail.js'); details = m.buildCampDetails({ scene, textures, U, heightAt, colliders, camp: { x: C.x, z: C.z }, dock: dockG, tentPos: new THREE.Vector3(tx0, 0, tz0), tentRot: 0.9, firePos: new THREE.Vector3(fx, heightAt(fx, fz), fz), night }); } catch (e) { console.warn('campdetail', e.message); }
}
if (night) { for (const l of lanterns) l.userData.light.intensity = 2.2; tent.userData.light.intensity = 1.2; const fl = new THREE.PointLight(0xff8a3a, 6, 12, 2); fl.position.set(fx, heightAt(fx, fz) + 0.5, fz); scene.add(fl); logs.userData.charred.emissiveIntensity = 2; }
const pc = (q.get('cam') || `${C.x + 3},${heightAt(C.x, C.z) + 1.6},${C.z + 4}`).split(',').map(Number);
const pl = (q.get('look') || `${C.x},${heightAt(C.x, C.z) + 0.3},${C.z}`).split(',').map(Number);
// cam/look can be given relative to camp with rel=1
if (q.has('dock') && window.__dockEnd) { const b = window.__dockEnd; for (let i = 0; i < 3; i++) { pc[i] += [b.x, b.y, b.z][i]; pl[i] += [b.x, b.y, b.z][i]; } }
else if (q.has('rel')) { const b = [C.x, heightAt(C.x, C.z), C.z]; for (let i = 0; i < 3; i++) { pc[i] += b[i]; pl[i] += b[i]; } }
cam.position.set(...pc); cam.lookAt(...pl);
details?.update?.(0.016, { night: night ? 1 : 0, time: 1, camera: cam });
// debug: hide meshes whose name contains any of ?hide=a,b
if (q.get('hide')) { const hs = q.get('hide').split(','); scene.traverse((o) => { if (o.isMesh && hs.some((h) => o.name.includes(h))) o.visible = false; }); }
if (q.get('probe')) scene.traverse((o) => { if (o.isMesh && o.name.includes(q.get('probe'))) { const c = o.geometry.attributes.color?.array || []; let mx = 0, sum = 0; for (const v of c) { mx = Math.max(mx, v); sum += v; } const m = o.material; console.log('PROBE', o.name, 'n', c.length / 3, 'max', mx.toFixed(3), 'avg', (sum / c.length).toFixed(3), 'vc', m.vertexColors, 'col', m.color?.getHexString(), 'map', !!m.map, m.map?.image?.width, 'emis', m.emissive?.getHexString(), 'side', m.side); } });
if (q.has('names')) { const n = []; scene.traverse((o) => { if (o.isMesh) n.push(o.name); }); console.log(n.join(' ')); }
r.render(scene, cam); r.render(scene, cam);
window.__info = { calls: r.info.render.calls, tris: r.info.render.triangles };
document.title = 'READY';
