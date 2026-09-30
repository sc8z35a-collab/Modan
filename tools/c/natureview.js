// Lane C nature viewer: world (terrain/trees/rocks/flora) + grass + sky lighting, no composer/water/props.
// URL: /tools/c/natureview.html?cam=x,y,z&look=x,y,z&hours=10&w=900&h=500&far=300&fov=55&grass=1&water=0
// cam/look y can be "g+1.6" (= ground height + 1.6)
import * as THREE from 'three';
import { QUALITY } from '../../src/core/renderer.js';
import { World, loadAssets } from '../../src/world/world.js';
import { Grass } from '../../src/world/grass.js';
import { Sky } from '../../src/world/sky.js';
import { Water } from '../../src/world/water.js';
import { heightAt, WORLD } from '../../src/world/heightfield.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 900), H = +(q.get('h') || 500);
const t0 = performance.now(); const lg = (...a) => console.log('[nv]', ((performance.now() - t0) / 1000).toFixed(1) + 's', ...a);
try {
  if (q.has('atlas')) { const { paintAtlas } = await import('../../src/world/flora.js'); const t = paintAtlas(); const c = t.image; c.style.cssText = 'position:fixed;left:0;top:0;width:100%;background:#7a8a6a'; document.body.appendChild(c); document.title = 'READY'; throw 'atlas'; }
  const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.AgXToneMapping; r.toneMappingExposure = +(q.get('exp') || 1.1);
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.info.autoReset = false;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(+(q.get('fov') || 55), W / H, 0.05, +(q.get('far') || 400));
  scene.add(cam);
  const Q = { ...QUALITY[q.get('q') || 'qa'] };
  if (q.has('trees')) Q.trees = +q.get('trees');
  const assets = await loadAssets(r, null, +(q.get('tex') || 256));
  lg('assets');
  const sky = new Sky(r, scene); sky.setShadowMapSize(+(q.get('shadow') || 1024));
  const world = new World(r, scene, assets, Q);
  world.build((s) => lg(s));
  world.buildInteractables?.(assets.models, assets.textures);
  lg('world built', world.treeCount, 'trees');
  let grass = null;
  if (q.get('grass') !== '0') grass = new Grass(scene, world.worldData, world.noiseTex, +(q.get('gd') || Q.grass));
  const parse = (s, d) => (s || d).split(',').map((v, i, a) => v);
  // aim=kind[,i[,dist[,height]]]: look at sample i of a flora kind from `dist` metres
  if (q.has('aim')) {
    const [kind, ii = 0, dist = 2.2, hh = 1.2] = q.get('aim').split(',');
    const smp = kind === 'pick' ? world.pickups.filter((p) => p.type === (q.get('ptype') || 'mushroom')).map((p) => [p.pos.x, p.pos.y, p.pos.z]) : world.flora.samples[kind]; const p = smp[Math.min(+ii, smp.length - 1)];
    const a = +(q.get('ang') || 0.7);
    q.set('cam', `${p[0] + Math.cos(a) * dist},g+${hh},${p[2] + Math.sin(a) * dist}`); q.set('look', `${p[0]},g+0.15,${p[2]}`);
    lg('aim', kind, p);
  }
  const cp = parse(q.get('cam'), `${WORLD.camp.x + 10},g+1.6,${WORLD.camp.z + 10}`);
  const lp = parse(q.get('look'), `${WORLD.camp.x},g+1,${WORLD.camp.z}`);
  const Y = (x, z, s) => (String(s).startsWith('g') ? Math.max(heightAt(x, z), 0) + (+(String(s).slice(1)) || 0) : +s);
  cam.position.set(+cp[0], Y(+cp[0], +cp[2], cp[1]), +cp[2]);
  cam.lookAt(+lp[0], Y(+lp[0], +lp[2], lp[1]), +lp[2]);
  cam.updateMatrixWorld();
  const hours = +(q.get('hours') || 10);
  sky.envTimer = 99; sky.update(hours, 0.016, cam.position);
  const night = sky.info.night;
  const dt = 0.016;
  world.update(dt, cam, +(q.get('bias') || 1));
  grass?.update(dt, cam.position, new THREE.Vector3(1e4, 0, 1e4), night, world.U.uWind.value);
  if (q.has('fire')) { const l = new THREE.PointLight(0xff8a3a, 30, 16, 2); l.position.set(WORLD.camp.x, heightAt(WORLD.camp.x, WORLD.camp.z) + 0.6, WORLD.camp.z); scene.add(l); }
  let water = null;
  if (q.get('water') !== '0') {
    water = new Water(r, scene, cam, world.worldData, 0.5); water.resize(W, H);
    const fire = { intensity: 0, position: new THREE.Vector3(), glintColor: new THREE.Color(0, 0, 0) };
    try { water.update(dt, sky, fire); water.renderReflection(grass ? grass.layers : []); } catch (e) { lg('water err', e.message); }
  }
  lg('render');
  r.info.reset();
  r.render(scene, cam);
  if (world.flora && q.has('floraoff')) world.flora.scatter.chunks.forEach((c) => c.lods.forEach((l) => l.meshes.forEach((m) => (m.visible = false))));
  if (q.has('floraoff')) { r.info.reset(); r.render(scene, cam); }
  let fm = 0, fms = 0, ftri = 0;
  [...(world.flora?.scatter.chunks || []), ...(world.flora?.fine.chunks || [])].forEach((c) => c.lods.forEach((l) => l.meshes.forEach((m) => { if (m.visible) { fm++; if (m.castShadow) fms++; const t = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * m.count; ftri += t; const k = m.name.replace(/\d+$/, ''); (window.__fk || (window.__fk = {}))[k] = ((window.__fk[k] || 0) + t) | 0; } })));
  window.__info = { byKind: window.__fk, floraMeshes: fm, floraShadowMeshes: fms, floraTris: Math.round(ftri), calls: r.info.render.calls, tris: r.info.render.triangles, trees: world.treeCount, flora: world.flora?.stats };
  r.render(scene, cam);
  lg('done', JSON.stringify(window.__info));
  // post=<qa-server origin>&name=<shot>: send the frame to tools/qa-server.mjs (/__snap) so the viewer can run in an
  // external browser (no Chromium in the 1GB sandbox)
  if (q.has('post')) {
    const png = r.domElement.toDataURL('image/jpeg', 0.88);
    await fetch(q.get('post') + '/__snap', { method: 'POST', body: JSON.stringify({ name: q.get('name') || 'nv', png, info: window.__info }) }).catch((e) => lg('post fail', e.message));
  }
  document.title = 'READY';
} catch (e) { if (e === 'atlas') {} else console.error('ERR', e?.stack || e); document.title = 'ERR'; }
