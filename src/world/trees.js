// Procedural high-detail trees (spruce/pine/birch) with canvas-painted foliage cards, 3 LODs and GPU wind.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/noise.js';

// ---------- foliage textures painted on canvas (albedo w/ alpha + normal-ish shading baked)
function paintNeedleCard(size = 512, hue = 'spruce') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const rnd = mulberry32(hue === 'spruce' ? 11 : 23);
  g.clearRect(0, 0, size, size);
  // central twig from bottom-center to top
  const drawBranch = (x0, y0, x1, y1, w, depth) => {
    g.strokeStyle = `rgb(${70 + rnd() * 20},${48 + rnd() * 12},${30})`;
    g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.floor(len / (hue === 'spruce' ? 2.2 : 3.2));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      for (const side of [-1, 1]) {
        const a = ang + side * (0.75 + rnd() * 0.5);
        const nl = (hue === 'spruce' ? 13 : 22) * (1 - t * 0.5) * (0.7 + rnd() * 0.5) * (size / 512);
        const l = 0.25 + rnd() * 0.3;
        const gr = hue === 'spruce' ? [22, 58, 30] : [48, 74, 30];
        g.strokeStyle = `rgb(${gr[0] * (1 + l)},${gr[1] * (1 + l)},${gr[2] * (1 + l)})`;
        g.lineWidth = (hue === 'spruce' ? 1.5 : 1.2) * (size / 512);
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); g.stroke();
      }
    }
    if (depth > 0) {
      const k = hue === 'spruce' ? 9 : 6;
      for (let i = 1; i < k; i++) {
        const t = i / k;
        const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
        const side = i % 2 ? 1 : -1;
        const a = ang + side * (0.6 + rnd() * 0.35);
        const l = len * 0.42 * (1 - t * 0.6);
        drawBranch(px, py, px + Math.cos(a) * l, py + Math.sin(a) * l, w * 0.55, depth - 1);
      }
    }
  };
  drawBranch(size / 2, size * 0.98, size / 2 + (rnd() - 0.5) * 20, size * 0.04, 6 * (size / 512), 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function paintLeafCard(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const rnd = mulberry32(77);
  for (let i = 0; i < 70; i++) {
    const x = size * (0.15 + rnd() * 0.7), y = size * (0.12 + rnd() * 0.8);
    const r = size * (0.035 + rnd() * 0.03);
    const a = rnd() * Math.PI * 2;
    const l = rnd();
    g.save(); g.translate(x, y); g.rotate(a);
    const grd = g.createLinearGradient(-r, 0, r, 0);
    grd.addColorStop(0, `rgb(${60 + l * 50},${95 + l * 60},${25 + l * 20})`);
    grd.addColorStop(1, `rgb(${40 + l * 40},${70 + l * 50},${18})`);
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,45,10,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// ---------- materials with wind
export function windify(mat, U, strength = 1, isLeaf = false) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec2 uWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float hh = max(position.y, 0.0);
          float ph = ip.x*0.13 + ip.z*0.17;
          float sway = (sin(uTime*0.9 + ph) * 0.6 + sin(uTime*1.7 + ph*1.3)*0.25 + 0.4) * ${(0.004 * strength).toFixed(4)} * hh * hh;
          transformed.xz += uWind * sway;
          ${isLeaf ? `
          float fl = sin(uTime*6.0 + position.x*3.0 + position.z*2.0 + ph) * 0.03 * hh * 0.1;
          transformed += normal * fl;` : ''}
        }`);
    if (isLeaf) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #if NUM_DIR_LIGHTS > 0
          float tr = pow(max(dot(normalize(vViewPosition), -directionalLights[0].direction), 0.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * tr * 0.7;
        #endif`);
    }
  };
  mat.customProgramCacheKey = () => 'wind' + strength + isLeaf;
  return mat;
}

// ---------- geometry helpers
function trunkGeo(h, r0, r1, radial, hs, bend = 0, rnd) {
  const g = new THREE.CylinderGeometry(r1, r0, h, radial, hs, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = y / h;
    const flare = 1 + Math.pow(1 - t, 6) * 0.6;
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const bump = 1 + Math.sin(a * 5 + y) * 0.05 * (1 - t);
    p.setX(i, p.getX(i) * flare * bump + Math.sin(t * 3) * bend * t);
    p.setZ(i, p.getZ(i) * flare * bump);
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(r0 * 6)), (y / h) * h * 0.6);
  }
  g.computeVertexNormals();
  return g;
}

// A foliage card: quad that droops outward. Normals bent outward from tree axis for soft volumetric shading.
function cardGeo(len, wid, droop, segs = 3) {
  const g = new THREE.PlaneGeometry(wid, len, 1, segs);
  g.translate(0, len / 2, 0);
  g.rotateX(-Math.PI / 2); // lies along +z (outward)
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = -p.getZ(i); const t = z / len;
    p.setZ(i, z);
    p.setY(i, -droop * t * t * len);
    p.setX(i, p.getX(i) * (1 - t * 0.3));
  }
  g.computeVertexNormals();
  return g;
}

function placeCard(base, m, pos, yaw, pitch, roll, s) {
  const g = base.clone();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  g.applyMatrix4(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s)));
  return g;
}

function bendNormalsOutward(g, cy, amount = 0.65) {
  const p = g.attributes.position, n = g.attributes.normal;
  const v = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    o.set(p.getX(i), (p.getY(i) - cy) * 0.6, p.getZ(i)).normalize();
    v.set(n.getX(i), n.getY(i), n.getZ(i));
    if (v.dot(o) < 0) v.negate();
    v.lerp(o, amount).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
}

// conifer builder: whorls of branch cards
function buildConifer(rnd, { h = 16, cards = 200, crown = 0.78, radius = 3.4, droop = 0.35, cardLen = 2.4 }) {
  const parts = [];
  const base = cardGeo(cardLen, cardLen * 0.95, droop, 3);
  const start = h * (1 - crown);
  const whorls = Math.round(cards / 7);
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = start + (h - start) * Math.pow(t, 0.9);
    const rr = radius * Math.pow(1 - t, 1.05) + 0.2;
    const n = Math.max(3, Math.round(7 * (1 - t * 0.5)));
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + w * 2.39 + rnd() * 0.5;
      const s = (rr / cardLen) * (0.85 + rnd() * 0.35);
      parts.push(placeCard(base, null, new THREE.Vector3(Math.sin(yaw) * 0.15, y + rnd() * 0.3, Math.cos(yaw) * 0.15), yaw, -0.25 + rnd() * 0.3 + t * -0.4, (rnd() - 0.5) * 0.6, Math.max(s, 0.25)));
    }
  }
  // top tuft
  for (let i = 0; i < 4; i++) parts.push(placeCard(base, null, new THREE.Vector3(0, h - 0.8, 0), i * 1.57, -1.2, 0, 0.4));
  const g = mergeGeometries(parts);
  bendNormalsOutward(g, start + (h - start) * 0.4);
  return g;
}

function buildBirchCrown(rnd, h) {
  const parts = [];
  const base = cardGeo(1.8, 1.8, 0.2, 2);
  for (let i = 0; i < 130; i++) {
    const t = rnd();
    const y = h * (0.45 + t * 0.55);
    const rr = Math.sin(t * Math.PI) * 2.6 + 0.4;
    const yaw = rnd() * Math.PI * 2;
    const d = rr * (0.3 + rnd() * 0.7);
    parts.push(placeCard(base, null, new THREE.Vector3(Math.sin(yaw) * d * 0.6, y, Math.cos(yaw) * d * 0.6), yaw, -0.6 + rnd() * 1.2, rnd() * 3, 0.8 + rnd() * 0.5));
  }
  const g = mergeGeometries(parts);
  bendNormalsOutward(g, h * 0.72, 0.75);
  return g;
}

function paintBirchBark(size = 256) {
  const c = document.createElement('canvas'); c.width = size; c.height = size * 2;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e4da'; g.fillRect(0, 0, size, size * 2);
  const rnd = mulberry32(5);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(${20 + rnd() * 30},${20 + rnd() * 20},${18},${0.5 + rnd() * 0.5})`;
    const y = rnd() * size * 2, w = size * (0.05 + rnd() * 0.35), x = rnd() * size;
    g.fillRect(x, y, w, 1 + rnd() * 4);
    if (x + w > size) g.fillRect(x - size, y, w, 1 + rnd() * 4);
  }
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(120,110,95,${rnd() * 0.15})`; g.fillRect(rnd() * size, rnd() * size * 2, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createTreeKinds(textures, U, quality = 1) {
  const kinds = {};
  const barkMat = windify(new THREE.MeshStandardMaterial({
    map: textures.pine_bark.diff, normalMap: textures.pine_bark.nor, roughnessMap: textures.pine_bark.arm, aoMap: textures.pine_bark.arm,
    roughness: 1, color: 0xb8a898,
  }), U, 0.6);
  for (const k of ['diff', 'nor', 'arm']) textures.pine_bark[k].wrapS = textures.pine_bark[k].wrapT = THREE.RepeatWrapping;
  const spruceTex = paintNeedleCard(512, 'spruce');
  const pineTex = paintNeedleCard(512, 'pine');
  const leafTex = paintLeafCard(512);
  const mkFol = (map, col) => windify(new THREE.MeshStandardMaterial({
    map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, color: col,
    alphaToCoverage: true,
  }), U, 1, true);
  const spruceMat = mkFol(spruceTex, 0xd8e8d0);
  const pineMat = mkFol(pineTex, 0xe6f0d0);
  const birchMat = mkFol(leafTex, 0xffffff);
  const birchBark = windify(new THREE.MeshStandardMaterial({ map: paintBirchBark(), roughness: 0.8 }), U, 0.6);
  // far LOD: solid cones (cheap), textured with same foliage via vertex color darkening
  const farMat = new THREE.MeshStandardMaterial({ color: 0x1d3320, roughness: 0.95, flatShading: false });

  const variants = [];
  const rnd = mulberry32(4242);
  // spruces
  for (let v = 0; v < 4; v++) {
    const h = 14 + v * 3.5 + rnd() * 2;
    const r = h * 0.22;
    const fol0 = buildConifer(rnd, { h, cards: Math.round(260 * quality), radius: r, droop: 0.45, cardLen: 2.2 });
    const fol1 = buildConifer(rnd, { h, cards: Math.round(90 * quality), radius: r, droop: 0.45, cardLen: 3.0 });
    const cone = new THREE.ConeGeometry(r * 1.05, h * 0.82, 9, 3); cone.translate(0, h * 0.18 + h * 0.41, 0);
    const trunk0 = trunkGeo(h, 0.28 + v * 0.05, 0.04, 12, 10, 0.1, rnd);
    const trunk1 = trunkGeo(h, 0.28 + v * 0.05, 0.04, 6, 2, 0, rnd);
    variants.push({ name: 'spruce' + v, radius: 0.35 + v * 0.05, lods: [
      { dist: 60, parts: [{ geo: trunk0, mat: barkMat, castShadow: true }, { geo: fol0, mat: spruceMat, castShadow: true }] },
      { dist: 150, parts: [{ geo: trunk1, mat: barkMat, castShadow: true }, { geo: fol1, mat: spruceMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: cone, mat: farMat, castShadow: false }] },
    ] });
  }
  // pines (taller, crown high)
  for (let v = 0; v < 3; v++) {
    const h = 18 + v * 3;
    const fol0 = buildConifer(rnd, { h, cards: Math.round(170 * quality), crown: 0.45, radius: 3.2, droop: 0.15, cardLen: 2.6 });
    const fol1 = buildConifer(rnd, { h, cards: 60, crown: 0.45, radius: 3.2, droop: 0.15, cardLen: 3.4 });
    const blob = new THREE.SphereGeometry(3, 8, 6); blob.scale(1, 1.4, 1); blob.translate(0, h * 0.78, 0);
    const trunk0 = trunkGeo(h, 0.36, 0.08, 12, 12, 0.5, rnd);
    const trunk1 = trunkGeo(h, 0.36, 0.08, 6, 2, 0.5, rnd);
    variants.push({ name: 'pine' + v, radius: 0.42, lods: [
      { dist: 60, parts: [{ geo: trunk0, mat: barkMat, castShadow: true }, { geo: fol0, mat: pineMat, castShadow: true }] },
      { dist: 150, parts: [{ geo: trunk1, mat: barkMat, castShadow: true }, { geo: fol1, mat: pineMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: trunk1, mat: farMat }, { geo: blob, mat: farMat }] },
    ] });
  }
  // birches
  for (let v = 0; v < 2; v++) {
    const h = 10 + v * 2.5;
    const crown = buildBirchCrown(rnd, h);
    const trunk = trunkGeo(h * 0.95, 0.16, 0.05, 10, 8, 0.4, rnd);
    const blob = new THREE.SphereGeometry(2.4, 8, 6); blob.scale(1, 1.3, 1); blob.translate(0, h * 0.72, 0);
    variants.push({ name: 'birch' + v, radius: 0.22, lods: [
      { dist: 70, parts: [{ geo: trunk, mat: birchBark, castShadow: true }, { geo: crown, mat: birchMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: trunk, mat: birchBark }, { geo: blob, mat: new THREE.MeshStandardMaterial({ color: 0x3e5a24, roughness: 0.9 }) }] },
    ] });
  }
  kinds.variants = variants;
  kinds.materials = { barkMat, spruceMat, pineMat, birchMat };
  return kinds;
}
