// Lane C nature viewer: world (terrain/trees/rocks/flora) + grass + sky lighting, no composer/water/props.
// URL: /tools/c/natureview.html?cam=x,y,z&look=x,y,z&hours=10&w=900&h=500&far=300&fov=55&grass=1&water=0
// cam/look y can be "g+1.6" (= ground height + 1.6)
import * as THREE from 'three';
import { QUALITY } from '../../src/core/renderer.js';
import { World, loadAssets } from '../../src/world/world.js';
import { Grass } from '../../src/world/grass.js';
import { Sky } from '../../src/world/sky.js';
import { heightAt, WORLD } from '../../src/world/heightfield.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 900), H = +(q.get('h') || 500);
const t0 = performance.now(); const lg = (...a) => console.log('[nv]', ((performance.now() - t0) / 1000).toFixed(1) + 's', ...a);
try {
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
  const cp = parse(q.get('cam'), `${WORLD.camp.x + 10},g+1.6,${WORLD.camp.z + 10}`);
  const lp = parse(q.get('look'), `${WORLD.camp.x},g+1,${WORLD.camp.z}`);
  const Y = (x, z, s) => (String(s).startsWith('g') ? heightAt(x, z) + (+(String(s).slice(1)) || 0) : +s);
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
  lg('render');
  r.info.reset();
  r.render(scene, cam);
  window.__info = { calls: r.info.render.calls, tris: r.info.render.triangles, trees: world.treeCount, flora: world.flora?.stats };
  r.render(scene, cam);
  lg('done', JSON.stringify(window.__info));
  document.title = 'READY';
} catch (e) { console.error('ERR', e?.stack || e); document.title = 'ERR'; }
