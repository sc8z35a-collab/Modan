// Hand-built procedural camp props with PBR materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './heightfield.js';
import { mulberry32 } from '../core/noise.js';

// deterministic 0..1 hash of a position (identical for coincident vertices of non-indexed geometry)
export function posHash(x, y, z, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453;
  return s - Math.floor(s);
}

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// ripstop nylon fabric: grid weave, panel seams, grime toward the ground (v=0 at ground)
function fabricTextures(base = '#c2572b', seam = 'rgba(0,0,0,0.22)') {
  const map = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    // subtle large-scale dye variation
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = 60 + Math.random() * 160;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const c = Math.random() > 0.5 ? '255,255,255' : '0,0,0';
      gr.addColorStop(0, `rgba(${c},0.035)`); gr.addColorStop(1, `rgba(${c},0)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    // ripstop grid
    g.globalAlpha = 0.09; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    for (let i = 0; i < w; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    g.globalAlpha = 0.05; g.strokeStyle = '#fff'; g.lineWidth = 1;
    for (let i = 2; i < w; i += 20) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    // stitched seams every 256px
    g.globalAlpha = 1; g.strokeStyle = seam; g.lineWidth = 5;
    for (let i = 0; i < w; i += 256) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
    g.setLineDash([6, 5]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < w; i += 256) for (const o of [-5, 5]) { g.beginPath(); g.moveTo(i + o, 0); g.lineTo(i + o, h); g.stroke(); }
    g.setLineDash([]);
    g.globalAlpha = 0.04;
    for (let i = 0; i < 9000; i++) { g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    // mud / grime near the ground (bottom of texture = v 0)
    g.globalAlpha = 1;
    const grd = g.createLinearGradient(0, h, 0, h * 0.72);
    grd.addColorStop(0, 'rgba(58,40,22,0.55)'); grd.addColorStop(0.35, 'rgba(58,40,22,0.18)'); grd.addColorStop(1, 'rgba(58,40,22,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(50,34,18,${Math.random() * 0.25})`; const x = Math.random() * w, y = h - Math.pow(Math.random(), 2.5) * h * 0.25; g.beginPath(); g.arc(x, y, 1 + Math.random() * 5, 0, 7); g.fill(); }
  });
  const nrm = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 10) { g.fillStyle = 'rgb(152,128,255)'; g.fillRect(i, 0, 1, h); g.fillStyle = 'rgb(104,128,255)'; g.fillRect(i + 1, 0, 1, h); g.fillStyle = 'rgb(128,152,255)'; g.fillRect(0, i, w, 1); g.fillStyle = 'rgb(128,104,255)'; g.fillRect(0, i + 1, w, 1); }
    // seam ridges
    for (let i = 0; i < w; i += 128) { g.fillStyle = 'rgb(90,128,255)'; g.fillRect(i - 3, 0, 3, h); g.fillStyle = 'rgb(166,128,255)'; g.fillRect(i, 0, 3, h); }
  }, false);
  return { map, nrm };
}

// Dome tent surface: rounded-square footprint, fabric sags between the two diagonal poles.
// a = azimuth (atan2(z,x)), e = elevation 0 (ground) .. PI/2 (apex).
const TENT = { Rx: 1.18, Rz: 1.06, H: 1.22 };
function domePoint(a, e, s = 1, out = new THREE.Vector3()) {
  const ca = Math.cos(a), sa = Math.sin(a);
  // superellipse footprint (squarish)
  const n = 3.2, k = Math.pow(Math.pow(Math.abs(ca), n) + Math.pow(Math.abs(sa), n), -1 / n);
  const sag = Math.pow(Math.cos(2 * a), 2); // 0 on poles (diagonals), 1 mid-panel
  const ce = Math.cos(e), se = Math.sin(e);
  const r = k * Math.pow(ce, 0.82) * (1 - 0.075 * sag * Math.sin(e * 2) - 0.03 * sag * se) * s;
  const y = TENT.H * Math.pow(se, 0.92) * (1 - 0.05 * sag * ce) * s;
  return out.set(ca * r * TENT.Rx, y, sa * r * TENT.Rz);
}
function domeGeometry(s, e0, e1, a0 = 0, a1 = Math.PI * 2, as = 96, es = 28) {
  const pos = [], uv = [], idx = [], v = new THREE.Vector3();
  for (let j = 0; j <= es; j++) for (let i = 0; i <= as; i++) {
    const a = a0 + (a1 - a0) * (i / as), e = e0 + (e1 - e0) * (j / es);
    domePoint(a, e, s, v); pos.push(v.x, v.y, v.z);
    uv.push((a / (Math.PI * 2)) * 4, e / (Math.PI / 2));
  }
  for (let j = 0; j < es; j++) for (let i = 0; i < as; i++) {
    const A = j * (as + 1) + i, B = A + 1, C = A + as + 1, D = C + 1;
    idx.push(A, C, B, B, C, D);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function tentMaterial(U, colorHex, glowMul, flutter, seam) {
  const { map, nrm } = fabricTextures(colorHex, seam);
  const mat = new THREE.MeshPhysicalMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.62, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(colorHex).lerp(new THREE.Color('#ffffff'), 0.4), side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uGlow = U.uTentGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fl = sin(uTime*2.3 + position.x*3.1 + position.z*2.3) * 0.6 + sin(uTime*5.7 + position.y*6.0 + position.x) * 0.4;
        transformed += normal * fl * ${flutter.toFixed(4)} * smoothstep(0.05, 0.7, position.y);`);
    // lantern inside: light transmits through the fabric (both faces)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += mix(diffuseColor.rgb, vec3(0.9,0.75,0.5), 0.5) * vec3(1.0,0.66,0.32) * uGlow * ${glowMul.toFixed(2)};`);
  };
  // three.js keys programs by onBeforeCompile.toString(), which is identical for both tent materials (the
  // flutter / glow numbers are closure values) -> the fly silently reused the inner tent's program
  // (glow x1.5, flutter 0.004). Make the key depend on the baked constants.
  mat.customProgramCacheKey = () => `tent:${flutter.toFixed(4)}:${glowMul.toFixed(2)}`;
  return mat;
}

export function buildTent(U) {
  const g = new THREE.Group();
  const innerMat = tentMaterial(U, '#d9c49a', 1.5, 0.004, 'rgba(90,60,20,0.25)');
  const flyMat = tentMaterial(U, '#476a3c', 0.55, 0.01, 'rgba(0,0,0,0.3)');
  const tubMat = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.55, metalness: 0.0 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1.0, roughness: 0.28 });
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xf05a28, roughness: 0.6, emissive: 0x200800 });
  const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; g.add(m); return m; };

  // bathtub floor (dark PU-coated rim, 12cm high)
  add(domeGeometry(1.0, 0, 0.1, 0, Math.PI * 2, 96, 3), tubMat);
  // inner tent body
  add(domeGeometry(0.995, 0.1, Math.PI / 2, 0, Math.PI * 2, 96, 30), innerMat);
  // inner door: D-shaped dark mesh panel on the front (+z) face, zipper half-open
  const door = add(domeGeometry(1.003, 0.1, 0.95, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, 24, 14), new THREE.MeshStandardMaterial({ color: 0x0d0b08, roughness: 0.95, transparent: true, opacity: 0.92, side: THREE.DoubleSide }), false);
  door.userData.door = true;
  // rainfly: sits 6cm off the inner, stops 16cm above ground so the tub shows
  add(domeGeometry(1.055, 0.16, Math.PI / 2, 0, Math.PI * 2, 96, 26), flyMat);

  // vestibule on the front: Coons-like surface between the fly's front arc and a ground curve to a stake
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const footL = domePoint(3 * Math.PI / 4, 0.16, 1.055), footR = domePoint(Math.PI / 4, 0.16, 1.055);
  const stake = new THREE.Vector3(0, 0.03, 2.05);
  const topArc = (u, out) => domePoint(3 * Math.PI / 4 + (Math.PI / 4 - 3 * Math.PI / 4) * u, 0.16 + Math.sin(Math.PI * u) * 0.95, 1.06, out);
  const ground = (u, out) => { const t = u; const a = footL.clone().lerp(stake, t * 2).setY(0.16 * (1 - Math.sin(Math.PI * u)) + 0.03); const b = stake.clone().lerp(footR, t * 2 - 1).setY(0.16 * (1 - Math.sin(Math.PI * u)) + 0.03); return out.copy(u < 0.5 ? a : b); };
  const vestibule = (u0, u1, US) => {
    const VS = 16, pos = [], uv = [], idx = [];
    for (let j = 0; j <= VS; j++) for (let i = 0; i <= US; i++) {
      const u = u0 + (u1 - u0) * (i / US), t = j / VS;
      topArc(u, v); ground(u, w);
      const p = v.clone().lerp(w, t);
      p.y -= Math.sin(Math.PI * t) * 0.06 * Math.sin(Math.PI * u); // fabric sag
      pos.push(p.x, p.y, p.z); uv.push(u * 2, 1 - t * 0.8);
    }
    for (let j = 0; j < VS; j++) for (let i = 0; i < US; i++) { const A = j * (US + 1) + i, B = A + 1, C = A + US + 1, D = C + 1; idx.push(A, C, B, B, C, D); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals(); return geo;
  };
  // left vestibule panel closed, right panel rolled up (door open)
  add(vestibule(0, 0.5, 24), flyMat);
  const rollPts = []; for (let i = 0; i <= 16; i++) { topArc(0.5 + 0.5 * (i / 16), v); rollPts.push(v.clone().add(new THREE.Vector3(0, 0.02, 0.05))); }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rollPts), 32, 0.045, 10), flyMat);
  // zipper line on closed panel edge
  const zipPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; topArc(0.5, v); ground(0.5, w); zipPts.push(v.clone().lerp(w, t).add(new THREE.Vector3(0, 0, 0.01))); }
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(zipPts), 16, 0.008, 5), tubMat, false);
  // toggles holding the rolled door
  for (const u of [0.62, 0.86]) { topArc(u, v); add(new THREE.TorusGeometry(0.05, 0.008, 6, 14), cordMat, false).position.copy(v).add(new THREE.Vector3(0, 0, 0.05)); }

  // poles: two crossing arcs along the diagonals (visible below the fly and at the feet), plus brow pole
  const poleCurve = (a) => { const pts = []; for (let i = 0; i <= 30; i++) { const e = (i / 30) * Math.PI; pts.push(e <= Math.PI / 2 ? domePoint(a, e, 1.03) : domePoint(a + Math.PI, Math.PI - e, 1.03)); } return new THREE.CatmullRomCurve3(pts); };
  for (const a of [Math.PI / 4, 3 * Math.PI / 4]) add(new THREE.TubeGeometry(poleCurve(a), 80, 0.0095, 8), poleMat);
  // pole feet: grommets + tips
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    domePoint(a, 0, 1.03, v);
    const tip = add(new THREE.CylinderGeometry(0.014, 0.012, 0.06, 10), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 }));
    tip.position.copy(v).setY(0.03);
    const web = add(new THREE.BoxGeometry(0.03, 0.12, 0.004), tubMat, false); web.position.copy(v).setY(0.06); web.lookAt(0, 0.06, 0);
  }

  // guy lines (reflective orange cord) + aluminium Y-stakes with tensioners
  const stakeGeo = new THREE.CylinderGeometry(0.008, 0.003, 0.22, 6); stakeGeo.translate(0, -0.04, 0);
  const stakeHead = new THREE.TorusGeometry(0.016, 0.004, 5, 10, Math.PI);
  const guy = (from, to) => {
    const mid = from.clone().lerp(to, 0.5); mid.y -= from.distanceTo(to) * 0.012;
    add(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(from, mid, to), 10, 0.0028, 4), cordMat, false);
    const st = add(stakeGeo, poleMat, false); st.position.copy(to); st.rotation.set(0.35 * Math.sign(to.z || 1), 0, -0.35 * Math.sign(to.x || 1));
    const hd = add(stakeHead, poleMat, false); hd.position.copy(to).setY(to.y + 0.07);
    const tn = add(new THREE.BoxGeometry(0.03, 0.012, 0.008), cordMat, false); tn.position.copy(from.clone().lerp(to, 0.82));
  };
  for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    const from = domePoint(a, 0.62, 1.06);
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    guy(from, dir.multiplyScalar(2.35).setY(0.03).add(new THREE.Vector3(0, 0, 0)));
  }
  guy(domePoint(-Math.PI / 2, 0.7, 1.06), new THREE.Vector3(0, 0.03, -2.3));
  guy(topArc(0.5, new THREE.Vector3()).clone(), new THREE.Vector3(0, 0.03, 2.75));
  // vestibule stake
  const vs = add(stakeGeo, poleMat, false); vs.position.copy(stake);

  // inner lantern light
  const light = new THREE.PointLight(0xffb060, 0, 5, 2);
  light.position.set(0, 0.55, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}

export function buildFireRing(textures) {
  const g = new THREE.Group();
  const rnd = mulberry32(3);
  const stoneMat = new THREE.MeshStandardMaterial({ map: textures.rocky_terrain_02.diff, normalMap: textures.rocky_terrain_02.nor, roughness: 0.9, color: 0x9a948c });
  const soot = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 1 });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const geo = new THREE.IcosahedronGeometry(0.2 + rnd() * 0.07, 2);
    const p = geo.attributes.position;
    const seed = i * 7.13;
    for (let j = 0; j < p.count; j++) {
      const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
      const k = 0.8 + posHash(+x.toFixed(4), +y.toFixed(4), +z.toFixed(4), seed) * 0.35;
      p.setXYZ(j, x * k, y * k * 0.7, z * k);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, stoneMat);
    m.position.set(Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), soot);
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02; ash.receiveShadow = true; g.add(ash);
  return g;
}

// firewood logs placed in the fire (visible count depends on fuel)
export function buildFireLogs(textures) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 0.95 });
  const charred = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, emissive: 0xff3300, emissiveIntensity: 0 });
  g.userData.charred = charred;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 10), i % 2 ? bark : charred);
    log.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
    log.rotation.set(0, -a, 0); log.rotateZ(0.95);
    log.castShadow = true;
    g.add(log);
  }
  return g;
}

export function buildLogSeat(textures, len = 2.2) {
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughnessMap: textures.bark_brown_02.arm, roughness: 1 });
  const endTex = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#b08a5a'; g.fillRect(0, 0, w, w);
    for (let r = 120; r > 4; r -= 5 + Math.random() * 4) { g.strokeStyle = `rgba(90,60,30,${0.3 + Math.random() * 0.3})`; g.lineWidth = 1.5; g.beginPath(); g.arc(128, 128, r, 0, 7); g.stroke(); }
    g.strokeStyle = '#3b2a18'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.stroke();
  });
  const endMat = new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.9 });
  const geo = new THREE.CylinderGeometry(0.22, 0.24, len, 20, 1);
  const m = new THREE.Mesh(geo, [bark, endMat, endMat]);
  m.rotation.z = Math.PI / 2; m.position.y = 0.2; m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  return g;
}

export function buildDock(textures, length = 14) {
  const g = new THREE.Group();
  const planks = textures.brown_planks_05;
  for (const k of ['diff', 'nor', 'arm']) { planks[k].wrapS = planks[k].wrapT = THREE.RepeatWrapping; }
  const mat = new THREE.MeshStandardMaterial({ map: planks.diff, normalMap: planks.nor, roughnessMap: planks.arm, roughness: 1, color: 0xb8a590 });
  const postMat = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, roughness: 1, color: 0x6a5a4a });
  const rnd = mulberry32(8);
  const w = 2.0, parts = [];
  for (let i = 0; i < length / 0.22; i++) {
    const b = new THREE.BoxGeometry(w + (rnd() - 0.5) * 0.08, 0.05, 0.2);
    // per-plank uv offset
    const uv = b.attributes.uv; const o = rnd();
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 0.5 + o, uv.getY(j) * 0.1 + o * 3);
    b.rotateY((rnd() - 0.5) * 0.02);
    b.translate(0, (rnd() - 0.5) * 0.01, -i * 0.22);
    parts.push(b);
  }
  const deck = new THREE.Mesh(mergeGeometries(parts), mat);
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  for (let i = 0; i <= length / 2.2; i++) for (const s of [-1, 1]) {
    // 3m posts ended at -2.25m while the lakebed under the far end is ~-3.8m: they hung in the water
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 5, 10), postMat);
    p.position.set(s * (w / 2 - 0.05), -2.3, -i * 2.2); p.castShadow = true; g.add(p);
  }
  // side beams
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, length), postMat);
    b.position.set(s * (w / 2 - 0.05), -0.1, -length / 2 + 0.1); g.add(b);
  }
  return g;
}

export function buildLantern() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3a2e, metalness: 0.8, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.28, depthWrite: false });
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 20), metal); base.position.y = 0.025;
  const glassM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 20, 1, true), glass); glassM.position.y = 0.13;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.06, 20), metal); top.position.y = 0.24;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.004, 6, 24, Math.PI), metal); handle.position.y = 0.27;
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), flame); f.scale.y = 1.8; f.position.y = 0.12;
  for (const m of [base, glassM, top]) m.castShadow = true;
  g.add(base, glassM, top, handle, f);
  const light = new THREE.PointLight(0xffb870, 0, 9, 2); light.position.y = 0.13;
  g.add(light);
  g.userData = { light, flame: f };
  return g;
}

export function buildChair() {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.4 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2e4f6e, roughness: 0.8, side: THREE.DoubleSide });
  const leg = (x1, z1, x2, z2) => {
    const a = new THREE.Vector3(x1, 0, z1), b = new THREE.Vector3(x2, 0.45, z2);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, a.distanceTo(b)), frame);
    m.position.copy(a).lerp(b, 0.5); m.lookAt(b); m.rotateX(Math.PI / 2); g.add(m);
  };
  leg(-0.25, -0.25, 0.25, 0.25); leg(0.25, -0.25, -0.25, 0.25); leg(-0.25, 0.25, 0.25, -0.25); leg(0.25, 0.25, -0.25, -0.25);
  const seat = new THREE.PlaneGeometry(0.52, 0.5, 8, 8); seat.rotateX(-Math.PI / 2);
  const p = seat.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -0.06 * (1 - (p.getX(i) / 0.26) ** 2) * (1 - (p.getZ(i) / 0.25) ** 2));
  seat.computeVertexNormals();
  const s = new THREE.Mesh(seat, cloth); s.position.y = 0.45; s.castShadow = true; g.add(s);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.5, 4, 4), cloth); back.position.set(0, 0.72, 0.28); back.rotation.x = -0.25; back.castShadow = true; g.add(back);
  return g;
}

export function buildKettle() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.85, roughness: 0.45 });
  const pts = [[0, 0], [0.1, 0], [0.12, 0.02], [0.125, 0.1], [0.1, 0.15], [0.05, 0.17], [0.03, 0.19], [0, 0.19]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m); body.castShadow = true; g.add(body);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.12, 8), m); spout.position.set(0.14, 0.12, 0); spout.rotation.z = -0.9; g.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 6, 24, Math.PI), m); handle.position.y = 0.19; g.add(handle);
  return g;
}

// tripod + grill over fire
export function buildTripod() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const base = new THREE.Vector3(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75), top = new THREE.Vector3(0, 1.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, base.distanceTo(top)), m);
    leg.position.copy(base).lerp(top, 0.5); leg.lookAt(top); leg.rotateX(Math.PI / 2); leg.castShadow = true; g.add(leg);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5), m); chain.position.y = 1.05; g.add(chain);
  const grill = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.008, 6, 32), m); grill.rotation.x = Math.PI / 2; grill.position.y = 0.8; g.add(grill);
  for (let i = -3; i <= 3; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55 * Math.sqrt(1 - (i / 3.5) ** 2)), m); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.8, i * 0.075); g.add(bar); }
  return g;
}

export function buildWoodPile(textures) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 1 });
  const cut = new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.9 });
  const rnd = mulberry32(12);
  let n = 0;
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - row; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.5, 7), [bark, cut, cut]);
    m.rotation.x = Math.PI / 2; m.rotation.y = (rnd() - 0.5) * 0.1;
    m.position.set((i - (5 - row) / 2) * 0.16, 0.08 + row * 0.14, (rnd() - 0.5) * 0.04);
    m.castShadow = true; g.add(m); n++;
  }
  g.userData.logs = g.children.slice();
  return g;
}

// fishing rod held in first-person
export function buildRod() {
  const g = new THREE.Group();
  const cork = new THREE.MeshStandardMaterial({ color: 0x9c7a50, roughness: 0.9 });
  const blank = new THREE.MeshStandardMaterial({ color: 0x1b2430, metalness: 0.3, roughness: 0.35 });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.35, 10), cork); h.position.y = 0.17; g.add(h);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.012, 2.1, 8), blank); b.position.y = 1.4; g.add(b);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.3 }));
  reel.rotation.z = Math.PI / 2; reel.position.set(0.03, 0.3, 0); g.add(reel);
  return g;
}

export function buildAxe(textures) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x777d82, metalness: 1, roughness: 0.3 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.7, 10), wood); handle.position.y = 0.35; g.add(handle);
  const shape = new THREE.Shape(); shape.moveTo(0, 0.03); shape.lineTo(0.14, 0.07); shape.quadraticCurveTo(0.17, 0, 0.14, -0.07); shape.lineTo(0, -0.03); shape.lineTo(-0.04, -0.025); shape.lineTo(-0.04, 0.025);
  const head = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004 }), steel);
  head.position.set(0, 0.66, -0.0125); g.add(head);
  return g;
}

export function placeOnGround(obj, x, z, yOff = 0, alignNormal = false) {
  obj.position.set(x, heightAt(x, z) + yOff, z);
  return obj;
}
