// Hand-built procedural camp props with PBR materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './heightfield.js';
import { mulberry32 } from '../core/noise.js';
import { addAxe } from './campdetail.js';
import { Batch, T, kitMaterials, kitTextures, rbox, box, cyl, tube, loft, sphere, torus, lathe, ribbon, pie, pieFace, jitter, smoothNormals } from './propkit.js';

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
  // 11 river stones (flattened, soot-blackened on the inner/upper faces), bedded into the ground, a bed of ash
  // with charcoal chunks and half-burnt ends, scorched earth ring around.
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  const rnd = mulberry32(3);
  const stoneMat = new THREE.MeshStandardMaterial({ name: 'ringStone', vertexColors: true, map: textures.rocky_terrain_02.diff, normalMap: textures.rocky_terrain_02.nor, roughness: 0.9 });
  const ashMat = new THREE.MeshStandardMaterial({ name: 'ash', vertexColors: true, map: kitTextures().grunge, roughness: 1 });
  const tints = [0xb49aaa, 0xa28fa0, 0xb8a0aa, 0x968494, 0xaa94a2]; // neutral greys: the texture itself is olive
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const geo = new THREE.IcosahedronGeometry(0.2 + rnd() * 0.07, 3);
    const p = geo.attributes.position; const seed = i * 7.13;
    for (let j = 0; j < p.count; j++) {
      const x = p.getX(j), y = p.getY(j), z = p.getZ(j);
      const k = 0.82 + posHash(+x.toFixed(4), +y.toFixed(4), +z.toFixed(4), seed) * 0.28 + 0.06 * Math.sin(x * 9 + seed) * Math.cos(z * 7);
      p.setXYZ(j, x * k * 1.1, y * k * 0.62, z * k * 0.9);
    }
    smoothNormals(geo); // polyhedra are non-indexed: computeVertexNormals alone gave flat facets
    const rx = Math.cos(a) * 0.72, rz = Math.sin(a) * 0.72, ry = -a + (rnd() - 0.5) * 0.6;
    // soot: inner side (toward the fire) and upper faces darkened, bottom damp/earthy
    B.add(geo, stoneMat, T(rx, 0.06 + rnd() * 0.03, rz, (rnd() - 0.5) * 0.3, ry, (rnd() - 0.5) * 0.3), tints[i % 5], { shade: (q, n, c) => {
      const inward = -(q.x * Math.cos(a) + q.z * Math.sin(a)) / 0.72 + 1; // >0 toward the centre
      const s = Math.min(1, Math.max(0, (0.72 - Math.hypot(q.x, q.z)) * 5 + 0.3) * (0.4 + 0.6 * Math.max(0, n.y + 0.3)));
      c.multiplyScalar(1 - 0.82 * s); if (q.y < 0.03) c.multiplyScalar(0.7); void inward;
    } });
  }
  // ash bed: domed disc, light grey centre -> black charcoal edge, conformed later by settle (flat ring area)
  const ash = new THREE.CircleGeometry(0.62, 40, 0, Math.PI * 2); ash.rotateX(-Math.PI / 2);
  { const p = ash.attributes.position; for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, 0.02 + 0.035 * (1 - (r / 0.62) ** 2) + (posHash(p.getX(i), 0, p.getZ(i), 4) - 0.5) * 0.01); } ash.computeVertexNormals(); }
  B.add(ash, ashMat, null, 0xffffff, { shade: (q, n, c) => { const r = Math.hypot(q.x, q.z) / 0.62; const v = 0.13 - 0.11 * r + (posHash(q.x * 3, 1, q.z * 3, 2) - 0.5) * 0.06; /* linear vertex colour: 0.13 ~ sRGB 100 grey ash */ c.setRGB(v, v * 0.97, v * 0.94); } });
  // charcoal chunks + white-ashed ember ends + scorched ground ring
  for (let i = 0; i < 38; i++) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 0.5, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const geo = new THREE.BoxGeometry(0.03 + rnd() * 0.05, 0.02 + rnd() * 0.02, 0.025 + rnd() * 0.04, 2, 1, 2); jitter(geo, 0.012, 40, i);
    const white = rnd() < 0.3;
    B.add(geo, ashMat, T(x, 0.035 + 0.03 * (1 - (d / 0.62) ** 2), z, rnd(), rnd() * 6, rnd()), white ? 0x5a5650 : 0x100e0c);
  }
  const scorch = new THREE.RingGeometry(0.55, 1.15, 40, 3); scorch.rotateX(-Math.PI / 2); scorch.translate(0, 0.012, 0);
  B.add(scorch, M.ao, null, 0x666666, { shade: (q, n, c) => { const r = Math.hypot(q.x, q.z); c.multiplyScalar(r < 0.85 ? 1 : Math.max(0, 1 - (r - 0.85) / 0.3)); } });
  B.build(g, 'firering');
  return g;
}

// firewood logs placed in the fire (visible count follows the fuel: userData.setFuel)
export function buildFireLogs(textures) {
  // teepee of 5 split logs + kindling. Bark logs and charred logs; charred ones carry the glow material so
  // main.js can drive userData.charred.emissiveIntensity. Glow is masked by an ember crack texture and fades
  // toward the unburnt upper ends (vertex colour).
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  const bark = new THREE.MeshStandardMaterial({ name: 'fireBark', vertexColors: true, map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 0.95 });
  const embers = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    const R = mulberry32(5);
    for (let i = 0; i < 70; i++) { c.strokeStyle = `rgba(255,${120 + R() * 100 | 0},40,${0.5 + R() * 0.5})`; c.lineWidth = 0.8 + R() * 2.5; c.beginPath(); let x = R() * w, y = R() * h; c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.5) * 40; y += (R() - 0.5) * 16; c.lineTo(x, y); } c.stroke(); }
  });
  const charred = new THREE.MeshStandardMaterial({ name: 'charred', vertexColors: true, color: 0xffffff, map: kitTextures().grunge, roughness: 1, emissive: 0xff3300, emissiveMap: embers, emissiveIntensity: 0 });
  g.userData.charred = charred;
  const rnd = mulberry32(6);
  // kindling first (always shown while there is fuel), then the logs one by one: marks[k] = vertex counts with
  // k logs, so setFuel() can reveal logs with drawRange on the merged meshes (no extra draw calls)
  for (let i = 0; i < 9; i++) { const a = rnd() * 6.28; B.add(cyl(0.008, 0.01, 0.35, 5), charred, T(Math.cos(a) * 0.06, 0.16, Math.sin(a) * 0.06, 0, -a, 0).multiply(T(0, 0, 0, 0, 0, 0.7 + rnd() * 0.3)), 0x1a1614); }
  const marks = [B.mark()];
  const order = [0, 3, 1, 4, 2]; // alternate sides so a half-fed fire still looks like a teepee
  for (const i of order) {
    const a = (i / 5) * Math.PI * 2 + (rnd() - 0.5) * 0.3, len = 0.72 + rnd() * 0.12;
    const r = 0.055 + rnd() * 0.02, full = i % 2 === 1;
    const geo = full ? cyl(r * 0.92, r, len, 10, 4) : pie(r * 1.25, len, Math.PI * (0.55 + rnd() * 0.3), rnd() * 6, 5, i).rotateX(Math.PI / 2);
    const m = T(Math.cos(a) * 0.19, 0.27, Math.sin(a) * 0.19, 0, -a, 0).multiply(T(0, 0, 0, 0, 0, 0.95));
    if (full) B.add(geo, bark, m, 0xc8bcb0, { shade: (q, n, c) => { if (q.y < 0.3) c.multiplyScalar(0.25 + q.y * 2); } });
    else B.add(geo, charred, m, 0x2a2420, { local: true, shade: (q, n, c) => { const t = (q.y / len) + 0.5; c.multiplyScalar(t > 0.75 ? 1.8 : 1); } });
    marks.push(B.mark());
  }
  const meshes = B.build(g, 'firelogs');
  // setFuel(f): fuel 0..1.2 -> 1..5 logs (a full load = 5 logs = 1.0). Called by main.js every frame (cheap: only
  // touches drawRange when the count changes).
  let shown = -1;
  g.userData.setFuel = (f) => {
    const k = Math.max(0, Math.min(5, Math.ceil(f / 0.2 - 1e-6)));
    if (k === shown) return; shown = k;
    for (const ms of meshes) ms.geometry.setDrawRange(0, marks[k].get(ms.material) ?? 0);
  };
  g.userData.setFuel(1.2);
  return g;
}

export function buildLogSeat(textures, len = 2.2) {
  // felled log bench: irregular bark cylinder with a flattened, adzed top where people sit, knots, end-grain
  // caps with checks, and two chocks keeping it from rolling.
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  const bark = new THREE.MeshStandardMaterial({ name: 'seatBark', vertexColors: true, map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughnessMap: textures.bark_brown_02.arm, roughness: 1 });
  const geo = new THREE.CylinderGeometry(0.22, 0.24, len, 28, 10, false);
  geo.rotateZ(Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(y, z); if (r < 1e-4) continue;
    const a = Math.atan2(z, y), k = 1 + 0.04 * Math.sin(a * 3 + x * 1.3) + 0.025 * Math.sin(x * 4.1 + a);
    let ny = y * k, nz = z * k;
    if (ny > 0.17) ny = 0.17 + (ny - 0.17) * 0.15; // flattened seat face
    p.setXYZ(i, x, ny, nz);
  }
  geo.computeVertexNormals();
  const Tm = T(0, 0.2, 0);
  B.add(geo, bark, Tm, 0xb8aca0, { local: true, face: (c, n) => (Math.abs(n.x) > 0.9 ? M.endgrain : c.y > 0.16 && n.y > 0.85 ? { mat: M.wood, color: 0xb89870 } : null) });
  // knots
  const rnd = mulberry32(len * 10 | 0);
  for (let i = 0; i < 4; i++) { const x = (rnd() - 0.5) * len * 0.8, a = rnd() * Math.PI + Math.PI * 0.1; B.add(sphere(0.03, 10, 6), bark, T(x, 0.2 + Math.cos(a) * 0.21, Math.sin(a) * 0.21 * (rnd() > 0.5 ? 1 : -1), 0, 0, 0, 1, 0.5, 1), 0x6a5a4a); }
  // chocks
  for (const x of [-len * 0.3, len * 0.3]) for (const sz of [-1, 1]) B.add(pie(0.06, 0.12, 1.2, 0, 3, x * 10 + sz).rotateY(Math.PI / 2), M.wood, T(x, 0.035, sz * 0.22, 0, 0, 0), 0xa88458);
  B.build(g, 'logseat');
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
  // hurricane (storm) lantern: fuel tank, wire guard, glass globe, chimney cap with vents, bail handle.
  // userData.light / userData.flame are driven by main.js.
  const g = new THREE.Group(), M = kitMaterials(), B = new Batch();
  const green = 0x2b3a2e;
  B.add(lathe([[0.001, 0], [0.075, 0], [0.085, 0.01], [0.088, 0.035], [0.078, 0.052], [0.05, 0.058], [0.035, 0.062], [0.001, 0.062]], 28), M.paint, null, green, { shade: (q, n, c) => { if (q.y < 0.012) c.multiplyScalar(0.6); } });
  B.add(cyl(0.012, 0.012, 0.018, 12), M.metal, T(0.06, 0.066, 0), 0xa89060); // filler cap
  B.add(cyl(0.004, 0.004, 0.04, 6).rotateZ(Math.PI / 2), M.metal, T(0.06, 0.075, -0.03), 0x888888); // wick knob stem
  B.add(cyl(0.012, 0.012, 0.004, 12).rotateZ(Math.PI / 2), M.metal, T(0.082, 0.075, -0.03), 0x888888);
  // burner collar
  B.add(cyl(0.03, 0.035, 0.02, 20), M.metal, T(0, 0.072, 0), 0x9a8a60);
  // side tubes (the "tubular" frame) from tank to top
  for (const sx of [-1, 1]) B.add(tube([[sx * 0.078, 0.05, 0], [sx * 0.085, 0.14, 0], [sx * 0.078, 0.23, 0], [sx * 0.05, 0.26, 0]], 0.006, 16, 6), M.paint, null, green);
  // wire guard around the globe
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + 0.26; B.add(tube([[Math.cos(a) * 0.058, 0.085, Math.sin(a) * 0.058], [Math.cos(a) * 0.072, 0.15, Math.sin(a) * 0.072], [Math.cos(a) * 0.05, 0.225, Math.sin(a) * 0.05]], 0.0016, 10, 3), M.metal, null, 0x777a7c); }
  for (const y of [0.12, 0.18]) B.add(torus(0.068, 0.0016, 3, 28), M.metal, T(0, y, 0, Math.PI / 2, 0, 0), 0x777a7c);
  // chimney: cone + vented cap
  B.add(lathe([[0.065, 0.225], [0.07, 0.232], [0.045, 0.265], [0.03, 0.28], [0.028, 0.29]], 24), M.paint, null, green);
  B.add(cyl(0.034, 0.034, 0.02, 16), M.paint, T(0, 0.3, 0), green);
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.28; B.add(box(0.008, 0.006, 0.003), M.rubber, T(Math.cos(a) * 0.034, 0.3, Math.sin(a) * 0.034, 0, -a + Math.PI / 2, 0), 0x0a0a0a); }
  B.add(cyl(0.036, 0.036, 0.004, 16), M.paint, T(0, 0.312, 0), green);
  // bail handle + grip
  B.add(tube([[-0.05, 0.26, 0], [-0.055, 0.34, 0], [0, 0.37, 0], [0.055, 0.34, 0], [0.05, 0.26, 0]], 0.0022, 24, 4), M.metal, null, 0x777a7c);
  B.add(cyl(0.008, 0.008, 0.04, 10).rotateZ(Math.PI / 2), M.wood, T(0, 0.37, 0), 0x6a4a30);
  B.build(g, 'lantern');
  // globe (transparent, separate so it sorts correctly) + wick flame
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xfff4e0, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  const globe = new THREE.Mesh(lathe([[0.03, 0.078], [0.052, 0.1], [0.06, 0.15], [0.052, 0.2], [0.04, 0.225]], 28), glass); g.add(globe);
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) });
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), flame); f.scale.set(1, 2.6, 1); f.position.y = 0.105; g.add(f);
  const light = new THREE.PointLight(0xffb870, 0, 9, 2); light.position.y = 0.14;
  g.add(light);
  g.userData = { light, flame: f };
  return g;
}

export function buildChair() {
  // folding director-style camp chair: powder-coated X frame, canvas seat + back with piping, armrest
  // straps and a mesh cup holder. Backrest at local +z; the sitter faces local -z.
  const g = new THREE.Group(), M = kitMaterials(), B = new Batch();
  const frame = 0x22262a, cloth = 0x2e4f6e, piping = 0x1b2f42;
  const leg = (a, b) => B.add(loft([a, a.clone().lerp(b, 0.5), b], () => [0.011, 0.011], 3, 10), M.paint, null, frame);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // side X's
  for (const sx of [-1, 1]) { leg(V(sx * 0.26, 0.01, -0.26), V(sx * 0.26, 0.46, 0.25)); leg(V(sx * 0.26, 0.01, 0.25), V(sx * 0.26, 0.46, -0.26)); B.add(cyl(0.008, 0.008, 0.03, 8).rotateZ(Math.PI / 2), M.metal, T(sx * 0.27, 0.235, 0), 0x9aa0a6); }
  // front/back X
  for (const sz of [-1, 1]) { leg(V(-0.26, 0.01, sz * 0.25), V(0.26, 0.46, sz * 0.25)); leg(V(0.26, 0.01, sz * 0.25), V(-0.26, 0.46, sz * 0.25)); }
  // back uprights + feet caps
  for (const sx of [-1, 1]) { leg(V(sx * 0.26, 0.46, 0.25), V(sx * 0.25, 0.9, 0.33)); for (const sz of [-1, 1]) B.add(sphere(0.016, 8, 6), M.rubber, T(sx * 0.26, 0.012, sz * 0.25 + (sz < 0 ? -0.01 : 0)), 0x151515); }
  // seat: sagging canvas with piping at the edges + seam
  const seat = new THREE.PlaneGeometry(0.52, 0.5, 12, 12); seat.rotateX(-Math.PI / 2);
  const p = seat.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -0.065 * (1 - (p.getX(i) / 0.26) ** 2) * (1 - (p.getZ(i) / 0.25) ** 2));
  seat.computeVertexNormals();
  B.add(seat, M.fabric, T(0, 0.46, 0), cloth, { shade: (q, n, c) => { if (Math.abs(q.x) > 0.24 || Math.abs(q.z) > 0.23) c.set(piping); } });
  for (const sx of [-1, 1]) B.add(cyl(0.012, 0.012, 0.52, 8).rotateX(Math.PI / 2), M.fabric, T(sx * 0.262, 0.465, 0), piping);
  // back panel: slight curve, sleeves over the uprights
  const back = new THREE.PlaneGeometry(0.5, 0.4, 10, 6); const bp = back.attributes.position; for (let i = 0; i < bp.count; i++) bp.setZ(i, 0.035 * (1 - (bp.getX(i) / 0.25) ** 2)); back.computeVertexNormals();
  B.add(back, M.fabric, T(0, 0.7, 0.3, -0.18, 0, 0), cloth, { shade: (q, n, c) => { if (q.y > 0.88 || q.y < 0.52) c.set(piping); } });
  for (const sx of [-1, 1]) B.add(cyl(0.017, 0.017, 0.4, 8), M.fabric, T(sx * 0.252, 0.7, 0.3, -0.18, 0, 0), piping);
  // armrest straps + cup holder
  for (const sx of [-1, 1]) B.add(ribbon([[sx * 0.265, 0.62, 0.29], [sx * 0.27, 0.6, 0.0], [sx * 0.265, 0.49, -0.26]], 0.045, 0.004, 10, V(1, 0, 0).set(0, 1, 0)), M.fabric, null, piping);
  B.add(cyl(0.045, 0.04, 0.09, 16, 1, true), M.fabric, T(0.33, 0.56, -0.12), 0x222222);
  B.add(torus(0.045, 0.004, 5, 16), M.paint, T(0.33, 0.605, -0.12, Math.PI / 2, 0, 0), frame);
  B.build(g, 'chair');
  return g;
}

export function buildKettle() {
  // enamelled camp kettle: body with shoulder, lid + knob, curved spout, wire bail with wooden grip, soot on
  // the bottom half (it hangs over the fire).
  const g = new THREE.Group(), M = kitMaterials(), B = new Batch();
  const col = 0x2c5a7a;
  B.add(lathe([[0.001, 0], [0.095, 0], [0.108, 0.008], [0.118, 0.04], [0.12, 0.09], [0.11, 0.13], [0.08, 0.155], [0.06, 0.16], [0.06, 0.168]], 32), M.enamel, null, col, { shade: (q, n, c) => { const t = Math.max(0, 1 - q.y / 0.08); c.lerp(new THREE.Color(0x0c0b0a), t * 0.9); if (q.y > 0.085 && q.y < 0.09) c.multiplyScalar(0.75); } });
  B.add(lathe([[0.001, 0.178], [0.05, 0.178], [0.062, 0.168], [0.064, 0.164]], 28), M.enamel, null, col);
  B.add(sphere(0.014, 12, 8), M.wood, T(0, 0.19, 0, 0, 0, 0, 1, 0.8, 1), 0x3a2418);
  // spout: tapered loft rising from the belly
  B.add(loft([[0.1, 0.06, 0], [0.145, 0.1, 0], [0.165, 0.15, 0], [0.185, 0.17, 0]], (t) => [0.022 - 0.013 * t, 0.022 - 0.013 * t], 12, 12, false), M.enamel, null, col);
  // bail + ears
  for (const sz of [-1, 1]) B.add(torus(0.008, 0.003, 5, 10), M.metal, T(0, 0.15, sz * 0.105, 0, 0, 0), 0x777777);
  B.add(tube([[0, 0.15, -0.105], [0, 0.23, -0.09], [0, 0.26, 0], [0, 0.23, 0.09], [0, 0.15, 0.105]], 0.0025, 20, 5), M.metal, null, 0x777777);
  B.add(cyl(0.009, 0.009, 0.06, 10).rotateX(Math.PI / 2), M.wood, T(0, 0.262, 0), 0x3a2418);
  B.build(g, 'kettle');
  return g;
}

// tripod + grill over fire
export function buildTripod() {
  // blacksmith tripod: 3 legs through a top ring, S-hook chain, round grate with radial bars. The kettle hangs
  // at y=0.81 on the grate (main.js).
  const g = new THREE.Group(), M = kitMaterials(), B = new Batch();
  const iron = 0x222222, top = new THREE.Vector3(0, 1.3, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2, base = new THREE.Vector3(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
    const tip = top.clone().add(new THREE.Vector3(-Math.cos(a) * 0.05, 0.06, -Math.sin(a) * 0.05));
    B.add(loft([base, base.clone().lerp(tip, 0.5), tip], () => [0.011, 0.011], 3, 8), M.iron, null, iron);
    B.add(cyl(0.004, 0.012, 0.05, 8), M.iron, T(base.x, 0.015, base.z), iron); // spike foot
  }
  B.add(torus(0.025, 0.008, 6, 14), M.iron, T(0, 1.3, 0, Math.PI / 2, 0, 0), iron);
  // chain links from ring to grate
  for (let i = 0; i < 17; i++) B.add(torus(0.012, 0.0025, 4, 10), M.iron, T(0, 1.27 - i * 0.026, 0, 0, i % 2 ? Math.PI / 2 : 0, 0, 1, 1.6, 1), iron);
  for (let i = 0; i < 3; i++) { const a = i / 3 * 6.28; B.add(cyl(0.002, 0.002, 0.36, 4), M.iron, T(Math.cos(a) * 0.14, 0.97, Math.sin(a) * 0.14, Math.sin(a) * 0.39, 0, -Math.cos(a) * 0.39), iron); }
  // grate: rim + 12 radial bars + inner ring
  B.add(torus(0.28, 0.008, 6, 40), M.iron, T(0, 0.8, 0, Math.PI / 2, 0, 0), iron);
  B.add(torus(0.1, 0.006, 6, 24), M.iron, T(0, 0.8, 0, Math.PI / 2, 0, 0), iron);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI; B.add(cyl(0.004, 0.004, 0.56, 5).rotateZ(Math.PI / 2), M.iron, T(0, 0.8, 0, 0, a, 0), iron); }
  B.build(g, 'tripod');
  return g;
}

export function buildWoodPile(textures) {
  // split firewood stacked between two stakes on two base rails; pieces are pie slices with bark on the arc,
  // end grain on the cut faces and pale split faces. All merged: 3-4 draw calls (was 15 meshes).
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  const bark = new THREE.MeshStandardMaterial({ name: 'pileBark', vertexColors: true, map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 1 });
  const rnd = mulberry32(12);
  for (const z of [-0.16, 0.16]) B.add(cyl(0.035, 0.035, 1.05, 8).rotateZ(Math.PI / 2), bark, T(0, 0.035, z), 0x9a8a7a);
  for (const x of [-0.5, 0.5]) B.add(cyl(0.022, 0.026, 0.75, 8), bark, T(x, 0.33, 0, 0, 0, x > 0 ? -0.06 : 0.06), 0x8a7a6a);
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - row; i++) {
    const R = 0.08 + rnd() * 0.02, ang = Math.PI * (0.45 + rnd() * 0.5), a0 = rnd() * 6.28;
    const geo = pie(R, 0.46 + rnd() * 0.06, ang, a0, 5, row * 10 + i);
    const m = T((i - (5 - row) / 2) * 0.16, 0.1 + row * 0.13, (rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.12, rnd() * 6.28);
    B.add(geo, bark, m, 0xa89888, { local: true, face: pieFace(M.endgrain, bark, M.wood, [0xd9b98a, 0xcfae80, 0xe0c498][i % 3]) });
  }
  B.build(g, 'woodpile');
  return g;
}

// fishing rod held in first-person
export function buildRod() {
  // spinning rod held in first person: cork split grip, reel seat, fixed-spool reel with handle + bail, tapered
  // blank with 6 guides and wraps. Rod space: butt at y=0, tip at y=2.45 (viewmodel.tip).
  const g = new THREE.Group(), M = kitMaterials(), B = new Batch();
  const blank = 0x1b2430, wrap = 0xb83a22;
  B.add(cyl(0.019, 0.021, 0.2, 14), M.wood, T(0, 0.1, 0), 0xc8a070, { shade: (q, n, c) => { if (((q.y * 90) | 0) % 3 === 0) c.multiplyScalar(0.88); } }); // rear cork
  B.add(cyl(0.017, 0.017, 0.09, 14), M.metal, T(0, 0.245, 0), 0x2a2e33); // reel seat
  B.add(cyl(0.018, 0.016, 0.1, 14), M.wood, T(0, 0.34, 0), 0xc8a070); // fore grip
  B.add(cyl(0.004, 0.012, 2.06, 10), M.paint, T(0, 1.42, 0), blank, { shade: (q, n, c) => { c.multiplyScalar(0.9 + 0.2 * Math.max(0, n.x)); } });
  B.add(sphere(0.004, 6, 4), M.metal, T(0, 2.45, 0), 0xc0c0c0); // tip top
  for (let i = 0; i < 6; i++) {
    const y = 0.62 + (1 - Math.pow(1 - i / 5, 1.4)) * 1.75, r = 0.018 - i * 0.0024, rb = 0.012 - i * 0.0014;
    B.add(cyl(rb + 0.0012, rb + 0.0012, 0.03, 8), M.paint, T(0, y, 0), wrap); // thread wrap
    B.add(cyl(0.0012, 0.0012, r * 1.4, 4), M.metal, T(0.0, y, rb + r * 0.7, Math.PI / 2, 0, 0), 0xb0b4b8); // foot
    B.add(torus(r, 0.0016, 4, 14), M.metal, T(0, y + 0.004, rb + r * 1.4 + r, 0, 0, 0), 0xb0b4b8); // ring
  }
  // fixed-spool reel under the rod (at +z)
  B.with(T(0, 0.25, 0.045), () => {
    B.add(box(0.012, 0.012, 0.05), M.metal, T(0, 0, -0.02), 0x3a3e42); // stem
    B.add(cyl(0.03, 0.028, 0.045, 18), M.metal, T(0, 0.02, 0.03), 0x3a3e42); // body
    B.add(cyl(0.026, 0.026, 0.03, 18), M.metal, T(0, 0.055, 0.03), 0xc8ccd0); // spool
    B.add(cyl(0.022, 0.022, 0.028, 18), M.plastic, T(0, 0.055, 0.03), 0xe8e4d0); // line on spool
    B.add(torus(0.032, 0.002, 4, 18, Math.PI), M.metal, T(0, 0.07, 0.03, Math.PI / 2, 0, 0), 0xd0d4d8); // bail
    B.add(cyl(0.003, 0.003, 0.05, 6).rotateZ(Math.PI / 2), M.metal, T(0.04, 0.02, 0.03), 0x3a3e42); // handle arm
    B.add(cyl(0.006, 0.006, 0.02, 8), M.plastic, T(0.065, 0.02, 0.045, Math.PI / 2, 0, 0), 0x111111); // knob
  });
  B.build(g, 'rod');
  return g;
}

export function buildAxe(textures) {
  // same axe model as the one stuck in the chopping block (campdetail addAxe): hickory handle, forged head
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  addAxe(B, M, new THREE.Matrix4());
  B.build(g, 'axe');
  return g;
}

export function placeOnGround(obj, x, z, yOff = 0, alignNormal = false) {
  obj.position.set(x, heightAt(x, z) + yOff, z);
  return obj;
}

// Drape a placed prop group onto the terrain: parts near the ground (tent tub, fly hem, guy lines, stakes) follow
// the real slope instead of the flat plane through the group origin (stakes floated up to 9cm on the downhill
// side, see tools/b/ground-check.mjs). Small parts move rigidly, large ones get per-vertex displacement weighted
// by height (1 at the ground -> 0 at `top`). Call once after the group is positioned/rotated.
export function settleToGround(group, heightFn, top = 0.7) {
  if (group.userData.settled) return group;
  group.updateMatrixWorld(true);
  const base = group.position.y - (group.userData.groundLift || 0), v = new THREE.Vector3(), mi = new THREE.Matrix4();
  const delta = (lx, ly, lz) => { v.set(lx, ly, lz).applyMatrix4(group.matrixWorld); return heightFn(v.x, v.z) - base; };
  const w = (y) => 1 - Math.min(1, Math.max(0, y / top));
  for (const m of group.children) {
    if (!m.isMesh) continue;
    const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    m.updateMatrix();
    if (g.boundingSphere.radius < 0.2) { // stakes, pole tips, tensioners: rigid move
      const k = w(m.position.y); if (k > 0) m.position.y += delta(m.position.x, m.position.y, m.position.z) * k;
      continue;
    }
    const ng = g.clone(), p = ng.attributes.position; mi.copy(m.matrix).invert();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrix); const k = w(v.y); if (k <= 0) continue;
      const lx = v.x, ly = v.y, lz = v.z, d = delta(lx, ly, lz) * k;
      v.set(lx, ly + d, lz).applyMatrix4(mi); p.setXYZ(i, v.x, v.y, v.z);
    }
    ng.computeVertexNormals(); ng.computeBoundingSphere(); m.geometry = ng;
  }
  group.userData.settled = true;
  return group;
}

// Folding camp table: roll-up wooden slat top (1.1 x 0.6, surface at y=0.715), aluminium frame, X legs with a
// centre pivot and rubber feet. userData.lantern = the lantern standing on it (lit by main.js like the others).
export function buildTable(textures) {
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch(), R = mulberry32(21);
  const Y = 0.715, W = 1.1, D = 0.6, n = 13, sw = D / n;
  for (let i = 0; i < n; i++) {
    const z = -D / 2 + sw * (i + 0.5), c = [0xc89a64, 0xbf915c, 0xd0a36c][i % 3];
    B.add(rbox(W, 0.018, sw - 0.004, 0.004, 1), M.wood, T(0, Y - 0.009, z, 0, 0, 0), c, { shade: (p, nn, cc) => { cc.multiplyScalar(0.92 + 0.08 * Math.sin(p.x * 9 + i)); } });
  }
  // cord holding the slats + aluminium side rails
  for (const x of [-0.42, 0.42]) B.add(cyl(0.003, 0.003, D, 6).rotateX(Math.PI / 2), M.rope, T(x, Y - 0.02, 0), 0x333333);
  for (const sz of [-1, 1]) B.add(rbox(W - 0.04, 0.025, 0.018, 0.004), M.metal, T(0, Y - 0.03, sz * (D / 2 - 0.02)), 0xb8bcc2);
  for (const sx of [-1, 1]) B.add(rbox(0.018, 0.025, D - 0.04, 0.004), M.metal, T(sx * (W / 2 - 0.05), Y - 0.03, 0), 0xb8bcc2);
  // X legs at each end + pivot bolts + feet
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.08);
    for (const sz of [-1, 1]) {
      const a = new THREE.Vector3(x, 0.012, sz * 0.26), b = new THREE.Vector3(x, Y - 0.045, -sz * 0.26);
      B.add(loft([a, a.clone().lerp(b, 0.5), b], () => [0.011, 0.011], 4, 10), M.metal, null, 0xa8adb3);
      B.add(rbox(0.03, 0.02, 0.05, 0.008), M.rubber, T(x, 0.01, sz * 0.26), 0x1a1a1a);
    }
    B.add(cyl(0.009, 0.009, 0.04, 10).rotateZ(Math.PI / 2), M.metal, T(x, (Y - 0.03) / 2, 0), 0x6a6e72);
  }
  B.add(loft([[-(W / 2 - 0.08), 0.2, 0.2], [0, 0.2, 0.2], [W / 2 - 0.08, 0.2, 0.2]], () => [0.008, 0.008], 3, 8), M.metal, null, 0xa8adb3); // brace
  B.add(tube([[-(W / 2 - 0.08), 0.2, -0.2], [0, 0.14, -0.2], [W / 2 - 0.08, 0.2, -0.2]], 0.006, 12, 6), M.metal, null, 0x9aa0a6);
  void R;
  B.build(g, 'table');
  const l = buildLantern(); l.position.set(-0.05, Y, 0.12); g.add(l); g.userData.lantern = l;
  return g;
}

// Clinker-built wooden rowboat (3.6m). Hull from an analytic section so the waterline cap matches exactly.
// Rim (gunwale) at local y=0, keel at -D. userData.cap = depth-only waterline mesh (hides the lake inside),
// main.js keeps using boatBaseY = waterLevel + 0.26 (waterline at local y=-0.26).
export function buildRowboat(textures, waterlineY = -0.26) {
  const g = new THREE.Group(), M = kitMaterials(textures), B = new Batch();
  const L = 1.8, D = 0.45, P = 2.3;
  const beam = (u) => 0.66 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), u < 0 ? 2.0 : 3.2)), u < 0 ? 0.62 : 0.4) + (u > 0 ? 0.3 * Math.pow(u, 6) : 0); // bow at -z, transom at +z
  const depth = (u) => D * (1 - 0.18 * u * u) + (u < 0 ? 0.0 : 0);
  const sheer = (u) => 0.1 * Math.pow(Math.abs(u), 2.2) * (u < 0 ? 1.3 : 0.6);
  const pt = (u, sN, off = 0) => { const b = Math.max(0.004, beam(u) - off), d = depth(u) - off; return [b * sN, -d * (1 - Math.pow(Math.abs(sN), P)) + sheer(u), u * L * (u > 0 ? 0.98 : 1)]; };
  const US = 40, SS = 24, strakes = 6;
  const hull = (off, colorOut) => {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= US; i++) for (let j = 0; j <= SS; j++) {
      const u = -1 + 2 * i / US, sN = -1 + 2 * j / SS; const [x, y, z] = pt(u, sN, off);
      // clinker steps: each strake overlaps the next -> small outward lip
      const st = Math.abs(sN) * strakes, f = st - Math.floor(st); const lip = off === 0 ? 0.006 * Math.pow(f, 3) : 0;
      pos.push(x + Math.sign(sN) * lip, y, z); uv.push(u * 3, Math.abs(sN) * 0.8);
    }
    for (let i = 0; i < US; i++) for (let j = 0; j < SS; j++) { const a = i * (SS + 1) + j, b = a + SS + 1; if (off === 0) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  };
  const planks = textures.brown_planks_05;
  const hullMat = new THREE.MeshStandardMaterial({ name: 'hull', vertexColors: true, map: planks.diff, normalMap: planks.nor, roughness: 0.75 });
  // painted outside: white topsides, green-blue below a waterline stripe, fouling at the bottom
  B.add(hull(0, 0), hullMat, null, 0xffffff, { shade: (p, n, c) => {
    const y = p.y; if (y > -0.06) c.setRGB(0.86, 0.84, 0.78); else if (y > -0.1) c.setRGB(0.55, 0.12, 0.08); else c.setRGB(0.18, 0.36, 0.42);
    const st = Math.abs(p.x) / 0.7 * strakes; if ((st % 1) > 0.9) c.multiplyScalar(0.8);
    if (y < -0.3) c.multiplyScalar(0.75); if (y < waterlineY + 0.02 && y > waterlineY - 0.03) c.multiplyScalar(0.85);
  } });
  B.add(hull(0.018, 0), hullMat, null, 0xb89a74, { shade: (p, n, c) => { if (p.y < -0.38) c.multiplyScalar(0.6); } }); // varnished inside
  // transom board
  const tr = new THREE.Shape(); const uT = 1; for (let j = 0; j <= 16; j++) { const sN = -1 + 2 * j / 16; const [x, y] = pt(uT, sN); j ? tr.lineTo(x, y) : tr.moveTo(x, y); } tr.closePath();
  B.add(new THREE.ExtrudeGeometry(tr, { depth: 0.03, bevelEnabled: false }), hullMat, T(0, 0, L * 0.98 - 0.015), 0xc8a878);
  // gunwale rails, stem, keel
  for (const sN of [-1, 1]) { const pts = []; for (let i = 0; i <= 30; i++) { const u = -1 + 2 * i / 30; const [x, y, z] = pt(u, sN); pts.push(new THREE.Vector3(x, y + 0.012, z)); } B.add(loft(pts, () => [0.022, 0.02], 60, 6), M.wood, null, 0x6a4a2a); }
  // stem post: from the keel at the bow up past the sheer
  { const [, yk, zb] = pt(-1, 0), top = sheer(-1) + 0.05, stem = []; for (let j = 0; j <= 10; j++) stem.push(new THREE.Vector3(0, yk + (top - yk) * j / 10, zb - 0.012)); B.add(loft(stem, () => [0.025, 0.02], 10, 6), M.wood, null, 0x6a4a2a); }
  { const pts = []; for (let i = 0; i <= 20; i++) { const u = -0.98 + 1.96 * i / 20; const [, y, z] = pt(u, 0); pts.push(new THREE.Vector3(0, y - 0.015, z)); } B.add(loft(pts, () => [0.02, 0.03], 30, 6), M.wood, null, 0x2a3a3a); }
  // ribs (frames) inside
  for (let i = 1; i < 12; i++) { const u = -0.85 + i * 0.145; const pts = []; for (let j = 0; j <= 12; j++) { const sN = -0.96 + 1.92 * j / 12; const [x, y, z] = pt(u, sN, 0.024); pts.push(new THREE.Vector3(x, y, z)); } B.add(loft(pts, () => [0.012, 0.018], 16, 4), M.wood, null, 0xa88a64); }
  // floorboards + thwarts (seats) + knees + oarlocks
  for (let k = -2; k <= 2; k++) B.add(box(0.1, 0.015, 2.1), M.wood, T(k * 0.11, -D + 0.08, 0.1), 0xb89a74);
  const thwart = (u, h) => { const [x] = pt(u, 1, 0.02); const [, y] = pt(u, 1); B.add(rbox(x * 2, 0.03, 0.22, 0.006), M.wood, T(0, y - h, u * L), 0xd8c8a8); };
  thwart(-0.35, 0.2); thwart(0.2, 0.2); thwart(0.78, 0.2);
  for (const sN of [-1, 1]) { const [x, y, z] = pt(0.02, sN); B.add(cyl(0.008, 0.008, 0.06, 8), M.metal, T(x * 0.99, y + 0.05, z), 0xc9a15a); B.add(torus(0.025, 0.005, 6, 12, Math.PI), M.metal, T(x * 0.99, y + 0.08, z, 0, Math.PI / 2, 0), 0xc9a15a); }
  // two oars lying inside, blades on the stern thwart
  for (const sN of [-1, 1]) {
    const a = new THREE.Vector3(sN * 0.2, -0.22, -1.25), b = new THREE.Vector3(sN * 0.24, -0.16, 1.0);
    B.add(loft([a, a.clone().lerp(b, 0.5), b], () => [0.018, 0.018], 6, 8), M.wood, null, 0xd8b88a);
    B.add(rbox(0.13, 0.012, 0.5, 0.005), M.wood, T(b.x, b.y + 0.01, b.z + 0.25, 0.06, 0, 0), 0xc8a070, { shade: (p, n, c) => { if (p.z > b.z + 0.42) c.setRGB(0.6, 0.12, 0.08); } });
    B.add(cyl(0.02, 0.02, 0.1, 10).rotateX(Math.PI / 2), M.rubber, T(a.x, a.y, a.z - 0.02), 0x2a2a2a);
  }
  // bow ring + painter rope trailing into the water
  const [, by, bz] = pt(-1, 0); B.add(torus(0.025, 0.005, 6, 14), M.metal, T(0, sheer(-1) - 0.08, bz - 0.03, 0, 0, 0), 0x9a9a9a);
  B.add(tube([[0, sheer(-1) - 0.1, bz - 0.04], [0.05, -0.2, bz - 0.2], [0.1, -0.32, bz - 0.5], [0.2, -0.3, bz - 0.9]], 0.009, 16, 5), M.rope, null, 0xc8b890); void by;
  B.build(g, 'boat');
  g.traverse((o) => { if (o.isMesh) o.material.side = o.material === hullMat ? THREE.FrontSide : o.material.side; });
  hullMat.side = THREE.DoubleSide;
  // waterline cap (depth only) following the hull section exactly
  const cs = new THREE.Shape(); const pts = [];
  for (let i = 0; i <= 40; i++) { const u = -1 + 2 * i / 40, d = depth(u), sy = waterlineY - sheer(u); const k = sy >= 0 ? 1 : Math.pow(Math.max(0, 1 + sy / d), 1 / P); pts.push([Math.max(0, beam(u) - 0.02) * k, u * L * (u > 0 ? 0.98 : 1)]); }
  pts.forEach(([x, z], i) => (i ? cs.lineTo(x, z) : cs.moveTo(x, z))); for (let i = pts.length - 1; i >= 0; i--) cs.lineTo(-pts[i][0], pts[i][1]);
  const capG = new THREE.ShapeGeometry(cs); capG.rotateX(Math.PI / 2); // shape (x, y=z) -> xz plane
  const cap = new THREE.Mesh(capG, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  cap.position.y = waterlineY; cap.renderOrder = 9; g.add(cap);
  g.userData.cap = cap; g.userData.bobT = 0;
  return g;
}
