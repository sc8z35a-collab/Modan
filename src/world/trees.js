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
          // wind is a WORLD direction: bring it into object space, otherwise every instance (random yaw)
          // swayed in its own direction and neighbouring trees waved against each other
          vec3 wObj = vec3(uWind.x, 0.0, uWind.y);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
            mat3 im3 = mat3(instanceMatrix);
            wObj = transpose(im3) * wObj / max(length(im3[0]), 1e-4); // rotation only: sway keeps scaling with the instance
          #endif
          float hh = max(position.y, 0.0);
          float ph = ip.x*0.13 + ip.z*0.17;
          float sway = (sin(uTime*0.9 + ph) * 0.6 + sin(uTime*1.7 + ph*1.3)*0.25 + 0.4) * ${(0.004 * strength).toFixed(4)} * hh * hh;
          transformed.xz += wObj.xz * sway;
          ${isLeaf ? `
          float fl = sin(uTime*6.0 + position.x*3.0 + position.z*2.0 + ph) * 0.03 * hh * 0.1;
          transformed += normal * fl;` : ''}
        }`);
    if (isLeaf) {
      // mip-aware alpha: keep foliage coverage at distance (prevents "stick trees")
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
        #ifdef USE_MAP
        {
          vec2 tsz = vec2(textureSize(map, 0));
          vec2 dx = dFdx(vMapUv * tsz), dy = dFdy(vMapUv * tsz);
          float lod = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
          diffuseColor.a *= 1.0 + lod * 0.45; // stronger now that alphaToCoverage is off
        }
        #endif
        #include <alphatest_fragment>`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        #if NUM_DIR_LIGHTS > 0
          float tr = pow(max(dot(normalize(vViewPosition), -directionalLights[0].direction), 0.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * tr * 0.7;
        #endif`);
    }
  };
  mat.customProgramCacheKey = () => 'wind2' + strength + isLeaf;
  return mat;
}

// ---------- geometry helpers
// trunk with root flare, bark ridges and optional exposed root buttresses; extends `sink` metres below y=0
// so it stays buried on slopes (the downhill side of the old trunks floated up to 0.3m above the ground)
function trunkGeo(h, r0, r1, radial, hs, bend = 0, rnd, { sink = 0.6, roots = 0 } = {}) {
  const g = new THREE.CylinderGeometry(r1, r0, h + sink, radial, hs, true);
  g.translate(0, (h + sink) / 2 - sink, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  const rootPh = rnd ? rnd() * 6.28 : 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = Math.max(0, y / h);
    const flare = 1 + Math.pow(1 - t, 6) * 0.6 + (y < 0 ? -y * 0.9 : 0);
    const a = Math.atan2(p.getZ(i), p.getX(i));
    // ridges (bark plates) + root buttresses that fade out ~1.2m up the trunk
    const bump = 1 + Math.sin(a * 5 + y) * 0.05 * (1 - t) + Math.sin(a * 17 + y * 3.1) * 0.012;
    const rootK = roots ? Math.pow(Math.max(0, Math.cos(a * roots + rootPh)), 6) * Math.max(0, 1 - Math.max(y, 0) / 1.2) * 0.55 : 0;
    const k = flare * bump + rootK;
    const bx = Math.sin(t * 3) * bend * t;
    p.setX(i, p.getX(i) * k + bx);
    p.setZ(i, p.getZ(i) * k);
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(r0 * 6)), y * 0.6);
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

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
function placeCard(base, m, pos, yaw, pitch, roll, s) {
  const g = base.clone();
  _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
  g.applyMatrix4(_m.compose(pos, _q, _s.set(s, s, s)));
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

// vertex colour AO: foliage deep inside the crown / low on the tree is darker (self-shadowing look that the
// shadow map is far too coarse to give). Stored in `color` (material.vertexColors)
function crownAO(g, h, radius, cy, min = 0.45) {
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    const loc = Math.max(0.2, radius * (1 - Math.max(0, y - cy) / Math.max(h - cy, 1e-3)) + 0.3);
    const outer = Math.min(1, rr / loc);
    const up = Math.min(1, Math.max(0, y / h));
    const ao = min + (1 - min) * (0.55 * outer + 0.45 * up);
    // slightly yellower fresh tips at the crown edge
    c[i * 3] = ao * (0.96 + outer * 0.08); c[i * 3 + 1] = ao; c[i * 3 + 2] = ao * (0.95 - outer * 0.05);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

// thin branch stubs (tapered 4-sided prisms) from trunk to (roughly) the foliage card base; dead ones hang lower
function branchSticks(rnd, list, h, pos, dirYaw, len, r0, droop) {
  const b = new THREE.CylinderGeometry(r0 * 0.25, r0, len, 4, 1, true);
  b.translate(0, len / 2, 0); b.rotateX(Math.PI / 2 - droop); b.rotateY(dirYaw);
  b.translate(pos.x, pos.y, pos.z);
  list.push(b);
}

// conifer builder: whorls of branch cards (+ the bare dead lower branches every real spruce/pine has)
function buildConifer(rnd, { h = 16, cards = 200, crown = 0.78, radius = 3.4, droop = 0.35, cardLen = 2.4, dead = 0, sticks = null }) {
  const parts = [];
  const base = cardGeo(cardLen, cardLen * 1.25, droop, 3);
  const start = h * (1 - crown);
  const whorls = Math.max(4, Math.round(cards / 7));
  const P = new THREE.Vector3();
  for (let w = 0; w < whorls; w++) {
    const t = w / whorls;
    const y = start + (h - start) * Math.pow(t, 0.9);
    const rr = radius * Math.pow(1 - t, 1.05) + 0.2;
    const n = Math.max(3, Math.round(7 * (1 - t * 0.5)));
    for (let i = 0; i < n; i++) {
      const yaw = (i / n) * Math.PI * 2 + w * 2.39 + rnd() * 0.5;
      const s = (rr / cardLen) * (0.85 + rnd() * 0.35);
      P.set(Math.sin(yaw) * 0.15, y + rnd() * 0.3, Math.cos(yaw) * 0.15);
      parts.push(placeCard(base, null, P, yaw, -0.25 + rnd() * 0.3 + t * -0.4, (rnd() - 0.5) * 0.6, Math.max(s, 0.25)));
      if (sticks && t < 0.55 && rnd() < 0.5) branchSticks(rnd, sticks, h, P, yaw, rr * 0.55, 0.035 * (1 - t) + 0.012, 0.2 + t * 0.2);
    }
  }
  // inner fill layer (hides the trunk, adds volume)
  const inner = cardGeo(cardLen * 0.7, cardLen * 0.9, droop * 0.6, 2);
  for (let w = 0; w < whorls * 0.8; w++) {
    const t = w / (whorls * 0.8);
    const y = start + (h - start) * t;
    const rr = radius * 0.55 * Math.pow(1 - t, 1.1) + 0.15;
    for (let i = 0; i < 4; i++) {
      const yaw = (i / 4) * Math.PI * 2 + w * 1.7 + rnd();
      parts.push(placeCard(inner, null, P.set(0, y, 0), yaw, -0.1 + rnd() * 0.4, (rnd() - 0.5) * 0.8, Math.max(rr / (cardLen * 0.7), 0.3)));
    }
  }
  // top tuft + leader shoot
  for (let i = 0; i < 4; i++) parts.push(placeCard(base, null, P.set(0, h - 0.8, 0), i * 1.57, -1.2, 0, 0.4));
  // dead lower branches: bare, drooping twigs below the live crown (self-pruning), trunk-only below ~2m
  if (sticks && dead > 0) {
    for (let k = 0; k < dead; k++) {
      const y = 2.2 + rnd() * Math.max(0.5, start - 2.2);
      const yaw = rnd() * Math.PI * 2, len = 0.4 + rnd() * 1.1;
      branchSticks(rnd, sticks, h, P.set(0, y, 0), yaw, len, 0.022 + rnd() * 0.02, -0.15 + rnd() * 0.5);
    }
  }
  const g = mergeGeometries(parts);
  bendNormalsOutward(g, start + (h - start) * 0.4);
  crownAO(g, h, radius, start);
  return g;
}

function buildBirchCrown(rnd, h, count = 130, sticks = null) {
  const parts = [];
  const base = cardGeo(1.8, 1.8, 0.2, 2);
  const P = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const t = rnd();
    const y = h * (0.45 + t * 0.55);
    const rr = Math.sin(t * Math.PI) * 2.6 + 0.4;
    const yaw = rnd() * Math.PI * 2;
    const d = rr * (0.3 + rnd() * 0.7);
    P.set(Math.sin(yaw) * d * 0.6, y, Math.cos(yaw) * d * 0.6);
    parts.push(placeCard(base, null, P, yaw, -0.6 + rnd() * 1.2, rnd() * 3, 0.8 + rnd() * 0.5));
  }
  // main scaffold limbs (birches fork into several ascending limbs, visible through the sparse crown)
  if (sticks) for (let k = 0; k < 7; k++) {
    const y = h * (0.4 + rnd() * 0.3), yaw = rnd() * Math.PI * 2;
    branchSticks(rnd, sticks, h, P.set(0, y, 0), yaw, 1.6 + rnd() * 1.4, 0.05 + rnd() * 0.02, 0.9 + rnd() * 0.4);
  }
  const g = mergeGeometries(parts);
  bendNormalsOutward(g, h * 0.72, 0.75);
  crownAO(g, h, 2.6, h * 0.45, 0.55);
  return g;
}

// birch bark: chalk-white with horizontal lenticels, black diamond scars at branch points, rough dark base
function paintBirchBark(size = 256) {
  const c = document.createElement('canvas'); c.width = size; c.height = size * 4;
  const g = c.getContext('2d'); const H = size * 4;
  const rnd = mulberry32(5);
  g.fillStyle = '#ebe7dc'; g.fillRect(0, 0, size, H);
  // warm/cool patches (peeling papery layers)
  for (let i = 0; i < 40; i++) {
    const x = rnd() * size, y = rnd() * H, r = 10 + rnd() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rnd() > 0.5 ? 'rgba(214,190,160,0.35)' : 'rgba(200,205,210,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const wrapRect = (x, y, w, hh) => { g.fillRect(x, y, w, hh); if (x + w > size) g.fillRect(x - size, y, w, hh); };
  // lenticels: short thin dark horizontal dashes
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${40 + rnd() * 40},${35 + rnd() * 30},${30},${0.35 + rnd() * 0.5})`;
    wrapRect(rnd() * size, rnd() * H, size * (0.03 + rnd() * 0.18), 1 + rnd() * 2);
  }
  // long dark bands
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${20 + rnd() * 25},${20 + rnd() * 20},18,${0.55 + rnd() * 0.4})`;
    wrapRect(rnd() * size, rnd() * H, size * (0.1 + rnd() * 0.4), 2 + rnd() * 5);
  }
  // black "eyes" / chevrons where branches were shed
  for (let i = 0; i < 9; i++) {
    const x = rnd() * size, y = rnd() * H * 0.85, w = 14 + rnd() * 18;
    g.fillStyle = 'rgba(18,16,14,0.85)';
    g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y - w * 0.5, x + w, y); g.quadraticCurveTo(x, y + w * 0.25, x - w, y); g.fill();
  }
  // base: rough black fissured bark on the lowest ~15%
  const gb = g.createLinearGradient(0, H, 0, H * 0.82);
  gb.addColorStop(0, 'rgba(38,33,28,1)'); gb.addColorStop(0.55, 'rgba(48,42,36,0.8)'); gb.addColorStop(1, 'rgba(48,42,36,0)');
  g.fillStyle = gb; g.fillRect(0, H * 0.82, size, H * 0.18);
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(230,225,215,${rnd() * 0.3})`; g.fillRect(rnd() * size, H * 0.84 + rnd() * H * 0.16, 1 + rnd() * 2, 6 + rnd() * 20); }
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(120,110,95,${rnd() * 0.15})`; g.fillRect(rnd() * size, rnd() * H, 2, 2); }
  // lichen dots (grey-green)
  for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(150,165,120,${0.2 + rnd() * 0.3})`; g.beginPath(); g.arc(rnd() * size, H * (0.5 + rnd() * 0.5), 1 + rnd() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// Scots-pine style: the bark turns thin, flaky and orange in the upper trunk. Done in the shader by height so
// the shared Poly Haven pine_bark maps stay the only textures (grey-brown plates below, copper above)
function pineUpperBark(mat, fromY, toY) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    prev?.(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTreeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTreeY = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTreeY;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float up = smoothstep(${fromY.toFixed(1)}, ${toY.toFixed(1)}, vTreeY);
          vec3 copper = vec3(0.78, 0.42, 0.22) * (0.55 + dot(diffuseColor.rgb, vec3(0.5)));
          diffuseColor.rgb = mix(diffuseColor.rgb, copper, up * 0.85);
        }`);
  };
  mat.customProgramCacheKey = () => 'pinebark' + fromY;
  return mat;
}

// moss on the north side and near the base of the trunk (world-space north = -z)
function mossyBark(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    prev?.(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vMossY; varying vec3 vMossN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vMossY = position.y;
        #ifdef USE_INSTANCING
          vMossN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vMossN = normalize(mat3(modelMatrix) * objectNormal);
        #endif`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vMossY; varying vec3 vMossN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float m = smoothstep(0.1, 0.8, -vMossN.z) * (1.0 - smoothstep(0.3, 2.2, vMossY)) + (1.0 - smoothstep(-0.2, 0.5, vMossY)) * 0.6;
          m *= smoothstep(0.25, 0.55, dot(diffuseColor.rgb, vec3(0.6)) + 0.2);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.22, 0.07), clamp(m, 0.0, 0.8));
        }`);
  };
  const prevKey = mat.customProgramCacheKey?.() || '';
  mat.customProgramCacheKey = () => prevKey + 'moss';
  return mat;
}

export function createTreeKinds(textures, U, quality = 1) {
  const kinds = {};
  for (const k of ['diff', 'nor', 'arm']) textures.pine_bark[k].wrapS = textures.pine_bark[k].wrapT = THREE.RepeatWrapping;
  const barkBase = () => new THREE.MeshStandardMaterial({
    map: textures.pine_bark.diff, normalMap: textures.pine_bark.nor, roughnessMap: textures.pine_bark.arm, aoMap: textures.pine_bark.arm,
    roughness: 1, color: 0xb8a898, normalScale: new THREE.Vector2(1.4, 1.4),
  });
  // same wind strength as the foliage: 0.6 vs 1.0 let the crowns drift up to ~1m off their trunks in gusts
  const barkMat = mossyBark(windify(barkBase(), U, 1));
  const pineBark = mossyBark(pineUpperBark(windify(barkBase(), U, 1), 6, 11));
  const twigMat = windify(new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 }), U, 1);
  const spruceTex = paintNeedleCard(512, 'spruce');
  const pineTex = paintNeedleCard(512, 'pine');
  const leafTex = paintLeafCard(512);
  const mkFol = (map, col) => windify(new THREE.MeshStandardMaterial({
    map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.78, color: col,
    vertexColors: true, // no alphaToCoverage: the composer target has no MSAA -> A2C degraded to dotted, dithered foliage
  }), U, 1, true);
  const spruceMat = mkFol(spruceTex, 0xd8e8d0);
  const pineMat = mkFol(pineTex, 0xe6f0d0);
  const birchMat = mkFol(leafTex, 0xffffff);
  const birchBark = windify(new THREE.MeshStandardMaterial({ map: paintBirchBark(), roughness: 0.75 }), U, 1);
  // far LOD: solid silhouettes; take the per-instance tint like the near foliage (tint colour is ~x1.0 there)
  const farMat = new THREE.MeshStandardMaterial({ color: 0x1e3520, roughness: 0.95 });
  const farBirch = new THREE.MeshStandardMaterial({ color: 0x2c4219, roughness: 0.9 });

  const variants = [];
  const rnd = mulberry32(4242);
  const q = Math.max(0.35, quality);
  // spruces
  for (let v = 0; v < 4; v++) {
    const h = 14 + v * 3.5 + rnd() * 2;
    const r = h * 0.22;
    const sticks0 = [];
    const fol0 = buildConifer(rnd, { h, cards: Math.round(260 * q), radius: r, droop: 0.45, cardLen: 2.2, dead: 10 + v * 3, sticks: sticks0 });
    const fol1 = buildConifer(rnd, { h, cards: Math.round(150 * Math.max(q, 0.6) * 0.8), radius: r, droop: 0.45, cardLen: 3.2 }); // floor: 6 whorls read as sticks
    // far cone: ragged 12-sided silhouette (a perfect cone read as a "christmas tree" at 20x zoom)
    const cone = new THREE.ConeGeometry(r * 1.05, h * 0.84, 12, 6); cone.translate(0, h * 0.18 + h * 0.42, 0);
    { const cp = cone.attributes.position; for (let i = 0; i < cp.count; i++) { const a = Math.atan2(cp.getZ(i), cp.getX(i)), y = cp.getY(i); const k = 1 + 0.16 * Math.sin(a * 6 + y * 1.7) * Math.sin(y * 2.3); cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); } cone.computeVertexNormals(); }
    const trunk0 = trunkGeo(h, 0.28 + v * 0.05, 0.04, 14, 12, 0.1, rnd, { roots: 5 });
    const trunk1 = trunkGeo(h, 0.28 + v * 0.05, 0.04, 6, 2, 0, rnd);
    const twigs = mergeGeometries(sticks0);
    variants.push({ name: 'spruce' + v, radius: 0.35 + v * 0.05, lods: [
      { dist: 60, parts: [{ geo: trunk0, mat: barkMat, castShadow: true, tint: false }, { geo: twigs, mat: twigMat, castShadow: true, tint: false }, { geo: fol0, mat: spruceMat, castShadow: true }] },
      { dist: 150, parts: [{ geo: trunk1, mat: barkMat, castShadow: true, tint: false }, { geo: fol1, mat: spruceMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: cone, mat: farMat, castShadow: false }] },
    ] });
  }
  // pines (taller, crown high). LOD1 used a fixed 110 cards -> on low quality it was HEAVIER than LOD0
  for (let v = 0; v < 3; v++) {
    const h = 18 + v * 3;
    const sticks0 = [];
    const fol0 = buildConifer(rnd, { h, cards: Math.round(170 * q), crown: 0.45, radius: 3.2, droop: 0.15, cardLen: 2.6, dead: 8, sticks: sticks0 });
    const fol1 = buildConifer(rnd, { h, cards: Math.round(170 * Math.max(q, 0.6) * 0.6), crown: 0.45, radius: 3.2, droop: 0.15, cardLen: 3.6 });
    const blob = new THREE.IcosahedronGeometry(3, 1); blob.scale(1.05, 1.25, 1.05);
    { const bp = blob.attributes.position; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i); const k = 0.82 + 0.3 * Math.abs(Math.sin(x * 1.3 + z * 0.7) * Math.cos(y * 1.1)); bp.setXYZ(i, x * k, y * k * (y < 0 ? 0.6 : 1), z * k); } }
    blob.translate(0, h * 0.8, 0); blob.computeVertexNormals();
    const trunk0 = trunkGeo(h, 0.36, 0.08, 14, 14, 0.5, rnd, { roots: 4 });
    const trunk1 = trunkGeo(h, 0.36, 0.08, 6, 3, 0.5, rnd);
    const twigs = mergeGeometries(sticks0);
    variants.push({ name: 'pine' + v, radius: 0.42, lods: [
      { dist: 60, parts: [{ geo: trunk0, mat: pineBark, castShadow: true, tint: false }, { geo: twigs, mat: twigMat, castShadow: true, tint: false }, { geo: fol0, mat: pineMat, castShadow: true }] },
      { dist: 150, parts: [{ geo: trunk1, mat: pineBark, castShadow: true, tint: false }, { geo: fol1, mat: pineMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: trunk1, mat: pineBark, tint: false }, { geo: blob, mat: farMat }] },
    ] });
  }
  // birches (had a single LOD for 70m..infinity => 130 alpha cards stayed until 70m then popped to a ball)
  for (let v = 0; v < 2; v++) {
    const h = 10 + v * 2.5;
    const sticks0 = [];
    const crown = buildBirchCrown(rnd, h, Math.round(130 * Math.max(0.6, q)), sticks0);
    const crown1 = buildBirchCrown(rnd, h, Math.round(60 * Math.max(0.6, q)));
    const trunk = trunkGeo(h * 0.95, 0.16, 0.05, 10, 10, 0.4, rnd, { roots: 3 });
    const trunk1 = trunkGeo(h * 0.95, 0.16, 0.05, 6, 3, 0.4, rnd);
    const limbs = mergeGeometries(sticks0);
    const blob = new THREE.IcosahedronGeometry(2.4, 1); blob.scale(1, 1.3, 1);
    { const bp = blob.attributes.position; for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i); const k = 0.8 + 0.3 * Math.abs(Math.sin(x * 1.7 + y) * Math.cos(z * 1.3)); bp.setXYZ(i, x * k, y * k, z * k); } }
    blob.translate(0, h * 0.72, 0); blob.computeVertexNormals();
    variants.push({ name: 'birch' + v, radius: 0.22, lods: [
      { dist: 45, parts: [{ geo: trunk, mat: birchBark, castShadow: true, tint: false }, { geo: limbs, mat: birchBark, castShadow: true, tint: false }, { geo: crown, mat: birchMat, castShadow: true }] },
      { dist: 110, parts: [{ geo: trunk1, mat: birchBark, castShadow: true, tint: false }, { geo: crown1, mat: birchMat, castShadow: true }] },
      { dist: Infinity, parts: [{ geo: trunk1, mat: birchBark, tint: false }, { geo: blob, mat: farBirch }] },
    ] });
  }
  kinds.variants = variants;
  kinds.materials = { barkMat, pineBark, spruceMat, pineMat, birchMat, birchBark, twigMat };
  return kinds;
}
