// Lane A lens/composer probe: light scene (terrain + camp props, no grass/trees by default) rendered through
// the SAME postprocessing chain as the game, so ultra-wide / tele / digital zoom and composer issues are testable
// inside the 1GB SwiftShader sandbox.  ?zoom=0.5|1|20|40 &pass=all|none|bloom... &hours=16 &w=640&h=288 &trees=0
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Lens } from '../../src/core/lens.js';
import { Sky } from '../../src/world/sky.js';
import { buildTerrain } from '../../src/world/terrain.js';
import { loadAssets } from '../../src/world/world.js';
import { heightAt, WORLD } from '../../src/world/heightfield.js';
import * as P from '../../src/world/props.js';
const q = new URLSearchParams(location.search);
const W = +(q.get('w') || 640), H = +(q.get('h') || 288);
const lg = (...a) => console.log('[lv]', ...a);
try {
  const r = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: false, preserveDrawingBuffer: true });
  r.setSize(W, H); r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(64, W / H, 0.08, 2600); scene.add(cam);
  const assets = await loadAssets(r, null, 256); lg('assets');
  const sky = new Sky(r, scene); sky.setShadowMapSize(1024);
  const t = buildTerrain(assets.textures, 4); scene.add(t.mesh);
  const C = WORLD.camp, U = { uTime: { value: 0 }, uTentGlow: { value: 0 } };
  const put = (o, x, z, ry = 0) => { o.position.set(x, heightAt(x, z), z); o.rotation.y = ry; scene.add(o); return o; };
  put(P.buildTent(U), C.x - 6.5, C.z + 3.5, 0.9); put(P.buildFireRing(assets.textures), C.x, C.z); put(P.buildTripod(), C.x, C.z);
  put(P.buildChair(), C.x + 0.4, C.z + 2.6, 0.15); put(P.buildWoodPile(assets.textures), C.x - 3.5, C.z - 2.2, 0.6);
  put(P.buildLogSeat(assets.textures), C.x + 2.4, C.z + 0.6, 1.4);
  // distance markers: coloured poles every 25m along the view line (to judge tele magnification + LOD)
  const cp = (q.get('cam') || `${C.x + 4},${C.z + 9}`).split(',').map(Number), yaw = +(q.get('yaw') || 2.9), pitch = +(q.get('pitch') || -0.05);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (let d = 25; d <= 200; d += 25) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(d / 200, 0.8, 0.5) })); const x = cp[0] + fx * d, z = cp[1] + fz * d; m.position.set(x, heightAt(x, z) + 1.5, z); scene.add(m); }
  cam.position.set(cp[0], heightAt(cp[0], cp[1]) + 1.65, cp[1]); cam.rotation.set(pitch, yaw, 0, 'YXZ');
  sky.envTimer = 99; sky.update(+(q.get('hours') || 16), 0.016, cam.position);
  const lens = new Lens(cam); lens.setBaseFov(64); lens.setZoom(+(q.get('zoom') || 1), true); lens.apply(true);
  const mode = q.get('pass') || 'all';
  if (mode === 'none') { r.render(scene, cam); }
  else {
    const composer = new EffectComposer(r, { frameBufferType: q.get('fb') === 'u8' ? THREE.UnsignedByteType : THREE.HalfFloatType });
    composer.addPass(new RenderPass(scene, cam));
    if (q.has('ao')) { const ao = new N8AOPostPass(scene, cam, W, H); ao.configuration.halfRes = true; ao.configuration.aoSamples = 8; ao.configuration.gammaCorrection = false; composer.addPass(ao); }
    if (mode !== 'lensonly') composer.addPass(new EffectPass(cam, new BloomEffect({ intensity: 1, mipmapBlur: true }), new ToneMappingEffect({ mode: ToneMappingMode.AGX }), new VignetteEffect()));
    if (mode === 'all') composer.addPass(new EffectPass(cam, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    if (lens.zoom !== 1 || q.has('forcelens')) composer.addPass(new EffectPass(cam, lens.effect));
    composer.setSize(W, H);
    composer.render(0.016); composer.render(0.016);
  }
  const px = new Uint8Array(4); const gl = r.getContext(); gl.readPixels(W >> 1, H >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  lg('done fov', cam.fov.toFixed(2), 'center px', [...px].join(','));
  document.title = 'READY';
} catch (e) { console.error('ERR', e?.stack || e); document.title = 'ERR'; }
