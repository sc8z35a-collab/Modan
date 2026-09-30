// Lane C: small-scale nature detail. Everything is instanced through the world's chunked Scatter (per-chunk
// frustum/distance culling, lodBias aware), textures are painted on canvas at load (no extra downloads).
//   meadow   : wildflower clusters (buttercup, oxeye daisy, harebell, fireweed, red clover), grass seed heads
//   forest   : pine cones, fallen twigs, needle / leaf litter decals, moss cushions, fly agaric + bolete clusters,
//              spruce saplings (tiny instances of the real tree kinds)
//   shore    : reed beds with cattails, water lilies (pads + flowers), wet pebbles, bleached driftwood
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, heightAt, lakeDist, normalAt } from './heightfield.js';
import { coverageAt, pathMask } from './terrain.js';
import { windify } from './trees.js';
import { Scatter } from './scatter.js';
import { mulberry32, createNoise2D, fbm, smoothstep } from '../core/noise.js';

// ---------------------------------------------------------------- atlas (4 x 2 cells, 256px each)
// 0 buttercup  1 oxeye daisy  2 harebell  3 fireweed  4 red clover  5 seed-head grass  6 needle litter  7 birch leaves
const CELL = 256, COLS = 4, ROWS = 2;
export function paintAtlas() {
  const c = document.createElement('canvas'); c.width = CELL * COLS; c.height = CELL * ROWS;
  const g = c.getContext('2d');
  const rnd = mulberry32(3131);
  const cell = (i, fn) => { g.save(); g.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); fn(); g.restore(); };
  const stem = (x0, y0, x1, y1, w = 3, col = '#3f6a22') => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + (rnd() - 0.5) * 20, (y0 + y1) / 2, x1, y1); g.stroke();
  };
  const leafBlade = (x, y, a, len, w, col) => {
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(w, -len * 0.5, 0, -len); g.quadraticCurveTo(-w, -len * 0.5, 0, 0); g.fill(); g.restore();
  };
  const petals = (x, y, n, r, w, col, centre, cr) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.2;
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col;
      g.beginPath(); g.ellipse(r * 0.55, 0, r * 0.55, w, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
    if (centre) { g.fillStyle = centre; g.beginPath(); g.arc(x, y, cr, 0, 7); g.fill(); }
  };
  // bottom of each cell = ground (v=0 in the quad), flowers grow up
  cell(0, () => { // buttercup: glossy yellow cups on thin branched stems, lobed basal leaves
    for (let k = 0; k < 6; k++) leafBlade(128 + (rnd() - 0.5) * 60, 256, (rnd() - 0.5) * 1.6, 50 + rnd() * 30, 14, '#3d6b23');
    for (let k = 0; k < 4; k++) {
      const x = 60 + rnd() * 136, y = 40 + rnd() * 90;
      stem(128 + (rnd() - 0.5) * 30, 256, x, y, 3);
      petals(x, y, 5, 22, 10, '#f3c91c', '#b88a0c', 5);
      g.fillStyle = 'rgba(255,255,220,0.7)'; g.beginPath(); g.arc(x - 6, y - 6, 3, 0, 7); g.fill();
    }
  });
  cell(1, () => { // oxeye daisy
    for (let k = 0; k < 5; k++) leafBlade(128 + (rnd() - 0.5) * 50, 256, (rnd() - 0.5) * 1.2, 45 + rnd() * 30, 9, '#44702a');
    for (let k = 0; k < 3; k++) {
      const x = 70 + rnd() * 116, y = 30 + rnd() * 70;
      stem(128 + (rnd() - 0.5) * 30, 256, x, y, 3.5);
      petals(x, y, 18, 34, 5, '#f7f5ee', '#e8b422', 9);
      g.fillStyle = 'rgba(150,100,10,0.5)'; g.beginPath(); g.arc(x + 2, y + 2, 5, 0, 7); g.fill();
    }
  });
  cell(2, () => { // harebell: nodding violet bells on hair-thin stems
    for (let k = 0; k < 5; k++) {
      const x = 50 + rnd() * 156, y = 40 + rnd() * 100;
      stem(128 + (rnd() - 0.5) * 40, 256, x, y, 2, '#4d7236');
      g.save(); g.translate(x, y); g.rotate(0.3 + rnd() * 0.5);
      const gr = g.createLinearGradient(0, 0, 0, 34); gr.addColorStop(0, '#5b5fc0'); gr.addColorStop(1, '#8f93e6');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-5, 0); g.quadraticCurveTo(-14, 26, -16, 34); g.lineTo(16, 34); g.quadraticCurveTo(14, 26, 5, 0); g.fill();
      g.restore();
    }
  });
  cell(3, () => { // fireweed: tall magenta spike
    stem(128, 256, 124, 20, 5, '#5b4a2a');
    for (let k = 0; k < 18; k++) {
      const t = k / 18, y = 30 + t * 130, x = 124 + (rnd() - 0.5) * 8;
      const r = 12 + t * 10;
      petals(x + (k % 2 ? 14 : -14) * (0.5 + t), y, 4, r, 7, t < 0.25 ? '#b54a8a' : '#d4549c', '#f0d0e0', 2);
    }
    for (let k = 0; k < 8; k++) leafBlade(126, 180 + k * 9, (k % 2 ? 1 : -1) * (0.9 + rnd() * 0.3), 42, 6, '#3a5e25');
  });
  cell(4, () => { // red clover: round pink-purple heads over trifoliate leaves
    for (let k = 0; k < 7; k++) {
      const x = 60 + rnd() * 136, y = 170 + rnd() * 60;
      for (let l = 0; l < 3; l++) { g.save(); g.translate(x, y); g.rotate(l * 2.1); g.fillStyle = '#3f6b28'; g.beginPath(); g.ellipse(0, -9, 6, 10, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(230,240,220,0.5)'; g.fillRect(-4, -10, 8, 2); g.restore(); }
    }
    for (let k = 0; k < 4; k++) {
      const x = 60 + rnd() * 136, y = 70 + rnd() * 80;
      stem(128 + (rnd() - 0.5) * 50, 256, x, y, 3);
      for (let f = 0; f < 40; f++) { const a = rnd() * 6.28, r = rnd() * 16; g.fillStyle = `rgb(${190 + rnd() * 40},${70 + rnd() * 40},${120 + rnd() * 40})`; g.beginPath(); g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, 3, 5, a, 0, 7); g.fill(); }
    }
  });
  cell(5, () => { // grass seed heads (timothy / wavy hair grass)
    for (let k = 0; k < 7; k++) {
      const x = 30 + rnd() * 196, y = 20 + rnd() * 60;
      stem(128 + (rnd() - 0.5) * 60, 256, x, y + 50, 2, '#8c8a4a');
      g.fillStyle = `rgb(${150 + rnd() * 30},${140 + rnd() * 20},${80})`;
      if (k % 2) { g.beginPath(); g.ellipse(x, y + 25, 4, 26, 0, 0, 7); g.fill(); }
      else for (let s = 0; s < 14; s++) { g.beginPath(); g.ellipse(x + (rnd() - 0.5) * 30, y + rnd() * 50, 2, 4, rnd(), 0, 7); g.fill(); }
    }
  });
  cell(6, () => { // needle litter: brown/rust needles + bits of bark and a cone scale (top-down decal, round falloff)
    for (let k = 0; k < 900; k++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 118, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      const l = 6 + rnd() * 10, b = rnd() * 6.28;
      g.strokeStyle = `rgba(${110 + rnd() * 60},${60 + rnd() * 30},${25 + rnd() * 15},${0.7 + rnd() * 0.3})`; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l); g.stroke();
    }
    for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(${70 + rnd() * 30},${45 + rnd() * 20},30,0.9)`; g.beginPath(); g.ellipse(128 + (rnd() - 0.5) * 180, 128 + (rnd() - 0.5) * 180, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, 7); g.fill(); }
  });
  cell(7, () => { // fallen birch / aspen leaves, yellow-brown
    for (let k = 0; k < 60; k++) {
      const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 105, x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      const s = 7 + rnd() * 7, rot = rnd() * 6.28, hue = rnd();
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = hue < 0.5 ? `rgb(${170 + rnd() * 60},${130 + rnd() * 50},${30 + rnd() * 20})` : `rgb(${120 + rnd() * 40},${80 + rnd() * 30},${35})`;
      g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s); g.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s); g.fill();
      g.strokeStyle = 'rgba(60,40,15,0.6)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s + 3); g.stroke();
      g.restore();
    }
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function paintMossTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); const rnd = mulberry32(88);
  g.fillStyle = '#35501a'; g.fillRect(0, 0, 256, 256);
  for (let k = 0; k < 5000; k++) { const l = rnd(); g.fillStyle = `rgba(${40 + l * 70},${70 + l * 70},${15 + l * 20},0.8)`; g.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5 + rnd() * 2); }
  for (let k = 0; k < 150; k++) { g.fillStyle = `rgba(150,140,50,${rnd() * 0.5})`; g.fillRect(rnd() * 256, rnd() * 256, 1, 4); } // sporophytes
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function paintAmanitaTex() { // red cap with white warts (spherical uv: v=1 top)
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d'); const rnd = mulberry32(12);
  const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#d8260f'); gr.addColorStop(0.8, '#e2531a'); gr.addColorStop(1, '#f2b04a');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  for (let k = 0; k < 70; k++) { const x = rnd() * 256, y = rnd() * 110; g.fillStyle = `rgba(250,246,230,${0.8 + rnd() * 0.2})`; g.beginPath(); g.ellipse(x, y, 2 + rnd() * 4, 1.5 + rnd() * 3, 0, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- geometry builders
const uvCell = (geo, idx) => { // remap 0..1 uvs into atlas cell idx
  const uv = geo.attributes.uv, cx = idx % COLS, cy = Math.floor(idx / COLS);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (cx + 0.02 + uv.getX(i) * 0.96) / COLS, 1 - (cy + 1 - (0.01 + uv.getY(i) * 0.98)) / ROWS);
  return geo;
};

// crossed vertical quads (x2) standing on y=0, normals tilted up so they light like foliage, not walls
function crossCard(w, h, idx, rnd) {
  const parts = [];
  const a0 = rnd() * Math.PI;
  for (let k = 0; k < 2; k++) {
    const q = new THREE.PlaneGeometry(w, h, 1, 2); q.translate(0, h / 2, 0); uvCell(q, idx);
    q.rotateY(a0 + k * Math.PI / 2);
    const n = q.attributes.normal; for (let i = 0; i < n.count; i++) { const v = new THREE.Vector3(n.getX(i), n.getY(i) + 1.2, n.getZ(i)).normalize(); n.setXYZ(i, v.x, v.y, v.z); }
    parts.push(q);
  }
  return mergeGeometries(parts);
}

function flowerCluster(rnd, idx, n, spread, size) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const s = size * (0.7 + rnd() * 0.6);
    const g = crossCard(s, s, idx, rnd);
    g.rotateX((rnd() - 0.5) * 0.15);
    g.translate((rnd() - 0.5) * spread, 0, (rnd() - 0.5) * spread);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

// ground decal (flat quad lying on y=0.01..0.02)
function decal(size, idx) {
  const q = new THREE.PlaneGeometry(size, size); q.rotateX(-Math.PI / 2); q.translate(0, 0.012, 0);
  return uvCell(q, idx);
}

// spruce cone (~11cm, cylindrical, pointed) lying on its side: lathe with spiral overlapping scales. Three cones
// per instance at random angles so the forest floor gets small scattered groups
function pineCone(seed, radial = 12) {
  const rnd = mulberry32(seed);
  const one = () => {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(Math.pow(Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5), 0.6) * 0.019 * (1.1 - t * 0.75) + 0.002, t * 0.11)); }
    const g = new THREE.LatheGeometry(pts, radial);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const k = 1 + 0.32 * Math.pow(Math.max(0, Math.sin(a * 6 + y * 190)), 3);
      p.setXYZ(i, x * k, y, z * k);
    }
    g.rotateZ(Math.PI / 2 - 0.12); g.translate(0.055, 0.017, 0);
    return g;
  };
  const parts = [];
  for (let k = 0; k < 3; k++) { const g = one(); g.rotateY(rnd() * 6.28); g.translate((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.5); parts.push(g); }
  const g = mergeGeometries(parts); g.computeVertexNormals();
  return g;
}

function twigGeo(rnd) {
  const parts = [];
  const main = new THREE.CylinderGeometry(0.006, 0.011, 0.5 + rnd() * 0.4, 5, 1, true);
  main.rotateZ(Math.PI / 2); main.translate(0, 0.01, 0); parts.push(main);
  for (let k = 0; k < 3; k++) {
    const l = 0.08 + rnd() * 0.15, b = new THREE.CylinderGeometry(0.002, 0.005, l, 4, 1, true);
    b.translate(0, l / 2, 0); b.rotateZ(-1.0 - rnd() * 0.6); b.rotateY((rnd() - 0.5) * 2); b.translate((rnd() - 0.5) * 0.4, 0.01, 0);
    parts.push(b);
  }
  return mergeGeometries(parts);
}

// moss cushion: lumpy low mound (several merged bumps), fine per-vertex fuzz; vertex colour: brighter tops,
// dark brown-green where it meets the ground
function mossCushion(seed, detail = 2) {
  const rnd = mulberry32(seed); // same bump layout for every LOD of the cushion
  const parts = [];
  for (let k = 0; k < 4; k++) {
    const b = new THREE.IcosahedronGeometry(0.1 + rnd() * 0.1, detail);
    b.scale(1, 0.45, 1); b.translate((rnd() - 0.5) * 0.3, -0.02, (rnd() - 0.5) * 0.3);
    parts.push(b);
  }
  const g = mergeGeometries(parts);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 1 + 0.08 * Math.sin(x * 90 + z * 70) * Math.cos(z * 80 - y * 60);
    p.setXYZ(i, x * f, Math.max(y * f, -0.04), z * f);
    const top = Math.min(1, Math.max(0, (y + 0.02) / 0.09));
    c[i * 3] = 0.45 + top * 0.55; c[i * 3 + 1] = 0.5 + top * 0.5; c[i * 3 + 2] = 0.4 + top * 0.3;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

function reedClump(rnd, n = 22, cattails = 3) {
  const blades = [], heads = [];
  for (let k = 0; k < n; k++) {
    const h = 0.9 + rnd() * 0.9, w = 0.012 + rnd() * 0.01;
    const b = new THREE.PlaneGeometry(w, h, 1, 3); b.translate(0, h / 2, 0);
    const p = b.attributes.position, lean = (rnd() - 0.2) * 0.35;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / h; p.setX(i, p.getX(i) * (1 - t * 0.9)); p.setZ(i, lean * t * t * h); }
    b.rotateY(rnd() * Math.PI); b.translate((rnd() - 0.5) * 0.5, -0.05, (rnd() - 0.5) * 0.5);
    b.computeVertexNormals();
    blades.push(b);
  }
  for (let k = 0; k < cattails; k++) {
    const h = 1.3 + rnd() * 0.5, x = (rnd() - 0.5) * 0.35, z = (rnd() - 0.5) * 0.35;
    const st = new THREE.CylinderGeometry(0.004, 0.006, h, 4, 1, true); st.translate(x, h / 2 - 0.05, z); blades.push(st);
    const hd = new THREE.CapsuleGeometry(0.016, 0.13, 1, 5); hd.translate(x, h - 0.2, z); heads.push(hd);
    const tip = new THREE.CylinderGeometry(0.001, 0.002, 0.12, 3, 1, true); tip.translate(x, h + 0.02, z); blades.push(tip);
  }
  return { blades: mergeGeometries(blades), heads: heads.length ? mergeGeometries(heads) : null };
}

function lilyPad(rnd) {
  const r = 0.12 + rnd() * 0.1, notch = 0.35;
  const g = new THREE.CircleGeometry(r, 22, notch / 2, Math.PI * 2 - notch);
  { const tmp = g.toNonIndexed(); g.dispose(); return lilyPadFinish(tmp, r); }
}
function lilyPadFinish(g, r) {
  g.rotateX(-Math.PI / 2);
  // curled-up rim + slight cup, uv-free vein shading via vertex colours (darker radial veins, lighter rim)
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z) / r, a = Math.atan2(z, x);
    p.setY(i, d * r * 0.05 + Math.pow(Math.max(0, d - 0.85), 2) * r * 1.6);
    const vein = 0.85 + 0.15 * Math.abs(Math.sin(a * 9));
    const k = vein * (0.85 + d * 0.25);
    c[i * 3] = k * (0.9 + d * 0.25); c[i * 3 + 1] = k; c[i * 3 + 2] = k * 0.85;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.translate(0, 0.012, 0); g.computeVertexNormals();
  return g;
}

function lilyFlower() {
  const parts = [];
  for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 8; k++) {
    const pt = new THREE.SphereGeometry(0.03, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2); pt.scale(0.45, 0.35, 1.3);
    pt.rotateX(-0.5 - ring * 0.5); pt.translate(0, 0.03, 0.025 - ring * 0.008); pt.rotateY((k / 8) * Math.PI * 2 + ring * 0.4);
    parts.push(pt);
  }
  const g = mergeGeometries(parts); g.translate(0, 0.012, 0);
  return g;
}

function pebble(rnd) {
  const g = new THREE.IcosahedronGeometry(0.05, 1);
  const p = g.attributes.position, sx = 0.7 + rnd() * 0.8, sz = 0.6 + rnd() * 0.7;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 0.9 + 0.12 * Math.sin(x * 60 + z * 40); p.setXYZ(i, x * sx * k, y * 0.45 * k, z * sz * k); }
  g.computeVertexNormals();
  return g;
}

function driftwood(rnd) {
  const len = 1.2 + rnd() * 1.6;
  const g = new THREE.CylinderGeometry(0.05, 0.09, len, 8, 8);
  const p = g.attributes.position, bend = (rnd() - 0.5) * 0.3;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / len; const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.12 * Math.sin(a * 3 + y * 9); p.setX(i, p.getX(i) * k + bend * y * y * len); p.setZ(i, p.getZ(i) * k); }
  g.rotateZ(Math.PI / 2); g.translate(0, 0.05, 0); g.computeVertexNormals();
  // a stubby broken branch
  const b = new THREE.CylinderGeometry(0.015, 0.035, 0.35, 6); b.translate(0, 0.17, 0); b.rotateZ(-0.6); b.translate(len * 0.15, 0.06, 0);
  return mergeGeometries([g.toNonIndexed(), b.toNonIndexed()]);
}

function mushroomCluster(rnd, kind) {
  const caps = [], stems = [];
  const n = 2 + ((rnd() * 4) | 0);
  for (let k = 0; k < n; k++) {
    const s = 0.6 + rnd() * 0.7, x = (rnd() - 0.5) * 0.25, z = (rnd() - 0.5) * 0.25;
    if (kind === 'amanita') {
      const h = 0.14 * s;
      const st = new THREE.CylinderGeometry(0.012 * s, 0.02 * s, h, 8, 2); st.translate(x, h / 2, z); stems.push(st);
      const ring = new THREE.CylinderGeometry(0.02 * s, 0.013 * s, 0.012 * s, 8, 1, true); ring.translate(x, h * 0.72, z); stems.push(ring);
      const volva = new THREE.SphereGeometry(0.022 * s, 8, 4); volva.scale(1, 0.6, 1); volva.translate(x, 0.004, z); stems.push(volva);
      const young = rnd() < 0.3;
      const cap = new THREE.SphereGeometry(0.055 * s, 14, 7, 0, Math.PI * 2, 0, young ? Math.PI * 0.62 : Math.PI * 0.42);
      cap.scale(1, young ? 0.9 : 0.5, 1); cap.translate(x, h - 0.004, z); caps.push(cap);
    } else { // bolete: fat stem, brown bun cap
      const h = 0.09 * s;
      const st = new THREE.CylinderGeometry(0.018 * s, 0.028 * s, h, 8, 2); st.translate(x, h / 2, z); stems.push(st);
      const cap = new THREE.SphereGeometry(0.05 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); cap.scale(1, 0.62, 1); cap.translate(x, h - 0.01, z); caps.push(cap);
      const pores = new THREE.CircleGeometry(0.048 * s, 12); pores.rotateX(Math.PI / 2); pores.translate(x, h - 0.008, z); stems.push(pores);
    }
  }
  return { caps: mergeGeometries(caps.map((g) => g.toNonIndexed())), stems: mergeGeometries(stems.map((g) => g.toNonIndexed())) };
}

// ---------------------------------------------------------------- Flora
export class Flora {
  constructor(world) {
    this.world = world; this.U = world.U; this.q = world.q;
    // own scatter with 128m chunks: ~20 small kinds x 64m chunks would have cost several hundred draw calls
    this.scatter = new Scatter(world.scene, 128);
    // tiny ground props (cones, moss, pebbles, twigs, fungi) live in a FINE 32m grid: with 128m chunks their
    // 32-45m cull / LOD distances were meaningless (chunk-level) -> every cone of a chunk drew at LOD0 (~2M tris)
    this.fine = new Scatter(world.scene, 32);
    this.stats = {}; this.samples = {}; // samples: a few positions per kind (QA viewer aims at them)
  }

  build() {
    const U = this.U, q = this.q, S = this.scatter, F = this.fine, WS = this.world.scatter;
    const sc_ = (name) => (F.kinds.has(name) ? F : S);
    const atlas = paintAtlas();
    const rnd = mulberry32(2718);
    const noise = createNoise2D(515);
    const canopy = this.world.canopyAt?.bind(this.world) || (() => 0);
    const gq = Math.max(0.3, q.grass ?? 1);

    // materials
    const cardMat = windify(new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 }), U, 60, true);
    const decalMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.35, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0x7a4e2c, roughness: 0.85 });
    const twigMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });
    const mossMat = new THREE.MeshStandardMaterial({ map: paintMossTex(), roughness: 1, color: 0xb0c090, vertexColors: true });
    const reedMat = windify(new THREE.MeshStandardMaterial({ color: 0x6f7f3a, side: THREE.DoubleSide, roughness: 0.7 }), U, 15, false);
    const cattailMat = windify(new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.95 }), U, 15, false);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x3f6526, roughness: 0.3, side: THREE.DoubleSide, vertexColors: true });
    const lilyMat = new THREE.MeshStandardMaterial({ color: 0xf8e4ea, roughness: 0.5, emissive: 0x1a1012 });
    const lilyHeart = new THREE.MeshStandardMaterial({ color: 0xf2c030, roughness: 0.6, emissive: 0x2a1c00 });
    const pebbleMat = new THREE.MeshStandardMaterial({ map: this.world.assets.textures.rocky_terrain_02?.diff, color: 0xffffff, roughness: 0.5 });
    const driftMat = new THREE.MeshStandardMaterial({ map: this.world.assets.textures.bark_brown_02?.diff, color: 0xb8b0a4, roughness: 0.9 });
    const amanitaCap = new THREE.MeshStandardMaterial({ map: paintAmanitaTex(), roughness: 0.45 });
    const boleteCap = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.5 });
    const fungusStem = new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.8 });
    const boleteStem = new THREE.MeshStandardMaterial({ color: 0xd8c8a4, roughness: 0.85 });

    const def = (name, variants, cull, opts = {}) => {
      for (let v = 0; v < variants.length; v++) (opts.fine ? F : S).defineKind(name + v, [{ dist: cull, parts: variants[v] }], { cullDist: cull });
      this.stats[name] = 0;
      return variants.length;
    };
    // near/far LOD kinds (a moss cushion at detail 3 was 6.4k tris -> flora hit 3M tris on ultra)
    const lod2 = (name, near, far, dNear, cull) => { F.defineKind(name + '0', [{ dist: dNear, parts: near }, { dist: cull, parts: far }], { cullDist: cull }); this.stats[name] = 0; return 1; };
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), qy = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0), nv = new THREE.Vector3();
    const col = new THREE.Color();
    const add = (name, nVar, x, z, s, { align = 0, sink = 0, y = null, color = null, tilt = 0 } = {}) => {
      const h = y ?? heightAt(x, z);
      if (align) { const n = normalAt(x, z); nv.set(n[0], n[1], n[2]); qt.setFromUnitVectors(UP, nv.lerp(UP, 1 - align).normalize()); } else qt.identity();
      qy.setFromAxisAngle(UP, rnd() * Math.PI * 2); qt.multiply(qy);
      if (tilt) { qy.setFromAxisAngle(ps.set(rnd() - 0.5, 0, rnd() - 0.5).normalize(), (rnd() - 0.5) * tilt); qt.premultiply(qy); }
      ps.set(x, h - sink, z); sc.setScalar(s);
      m.compose(ps, qt, sc);
      const kn = name + ((rnd() * nVar) | 0); sc_(kn).add(kn, m, color);
      this.stats[name]++; this.sample(name, x, h, z);
    };
    const C = WORLD.camp;
    const clear = (x, z, pad) => this.world.isCampClear(x, z, pad);
    const ring = (R, r0 = 0) => { const a = rnd() * Math.PI * 2, rr = r0 + Math.sqrt(rnd()) * (R - r0); return [C.x + Math.cos(a) * rr, C.z + Math.sin(a) * rr]; };

    // ---- meadow wildflowers (clustered patches, species by noise so each meadow has its own mix)
    const nFlower = def('flower', [0, 1, 2, 3, 4].map((idx) => [{ geo: flowerCluster(rnd, idx, 5 + ((rnd() * 3) | 0), 0.7, [0.62, 0.66, 0.5, 1.05, 0.42][idx]), mat: cardMat, castShadow: false }]), 70);
    const nSeed = def('seedgrass', [0].map(() => [{ geo: flowerCluster(rnd, 5, 5, 0.5, 0.8), mat: cardMat, castShadow: false }]), 60);
    for (let i = 0, placed = 0; i < 40000 && placed < Math.round(5200 * gq); i++) {
      const [x, z] = ring(150);
      const h = heightAt(x, z); if (h < 0.9) continue;
      const cov = coverageAt(x, z, h, 0);
      const patch = fbm(noise, x * 0.05, z * 0.05, 2);
      if (cov[0] < 0.45 || patch < 0.05 || canopy(x, z) > 0.4 || !clear(x, z, 1.5)) continue;
      // species by a second noise: yellow / white / violet / magenta / pink patches
      // species: a dominant one per patch (noise) + 40% random mix; fireweed (tall) rare and only at forest edges
      const dom = Math.floor(Math.abs(fbm(noise, x * 0.02 + 40, z * 0.02 - 13, 2)) * 997) % 5;
      let sp = rnd() < 0.6 ? dom : (rnd() * 5) | 0;
      if (sp === 3 && (cov[1] < 0.15 || rnd() < 0.6)) sp = [0, 1, 2, 4][(rnd() * 4) | 0];
      if (rnd() < 0.3) add('seedgrass', nSeed, x, z, 0.8 + rnd() * 0.5, { align: 0.3, sink: 0.02 });
      else { S.add('flower' + sp, m.compose(ps.set(x, h - 0.02, z), qt.setFromAxisAngle(UP, rnd() * 6.28), sc.setScalar(0.8 + rnd() * 0.5))); this.stats.flower++; this.sample('flower', x, h, z); }
      placed++;
    }

    // ---- forest floor: litter decals, cones, twigs, moss, mushrooms, saplings
    const nLitter = def('litter', [6, 7].map((idx) => [{ geo: decal(1.4, idx), mat: decalMat, castShadow: false }]), 55, { fine: true });
    const nCone = lod2('cone', [{ geo: pineCone(31, 12), mat: coneMat, castShadow: false }], [{ geo: pineCone(31, 5), mat: coneMat, castShadow: false }], 10, 32);
    const nTwig = def('twig', [0].map(() => [{ geo: twigGeo(rnd), mat: twigMat, castShadow: false }]), 38, { fine: true });
    const nMoss = lod2('moss', [{ geo: mossCushion(7, 2), mat: mossMat, castShadow: false }], [{ geo: mossCushion(7, 1), mat: mossMat, castShadow: false }], 22, 70);
    const amanita = [0].map(() => mushroomCluster(rnd, 'amanita')), bolete = [0].map(() => mushroomCluster(rnd, 'bolete'));
    const nAm = def('amanita', amanita.map((c) => [{ geo: c.caps, mat: amanitaCap, castShadow: false }, { geo: c.stems, mat: fungusStem, castShadow: false }]), 40, { fine: true });
    const nBo = def('bolete', bolete.map((c) => [{ geo: c.caps, mat: boleteCap, castShadow: false }, { geo: c.stems, mat: boleteStem, castShadow: false }]), 40, { fine: true });
    const forestSpot = (R, minCanopy) => {
      for (let k = 0; k < 30; k++) {
        const [x, z] = ring(R, 6);
        const h = heightAt(x, z); if (h < 1) continue;
        const cov = coverageAt(x, z, h, 0), cn = canopy(x, z);
        if ((cov[1] < 0.35 && cn < minCanopy) || !clear(x, z, 0.3)) continue;
        if (this.world.colliders.near(x, z, 0.15).length) continue; // not inside trunks / rocks
        return [x, z, cn];
      }
      return null;
    };
    for (let i = 0; i < Math.round(1800 * gq); i++) { const p = forestSpot(110, 0.3); if (p) add('litter', nLitter, p[0], p[1], 0.7 + rnd() * 1.1, { align: 1, color: col.setHSL(0.08, 0.2, 0.55 + rnd() * 0.3) }); }
    for (let i = 0; i < Math.round(1100 * gq); i++) { const p = forestSpot(90, 0.45); if (p) add('cone', nCone, p[0], p[1], 0.8 + rnd() * 0.5, { align: 1 }); }
    for (let i = 0; i < Math.round(900 * gq); i++) { const p = forestSpot(90, 0.25); if (p) add('twig', nTwig, p[0], p[1], 0.7 + rnd() * 0.8, { align: 1, sink: 0.005 }); }
    for (let i = 0; i < Math.round(900 * gq); i++) { const p = forestSpot(120, 0.5); if (p) add('moss', nMoss, p[0], p[1], 1.2 + rnd() * 2.2, { align: 1, sink: 0.03, color: col.setHSL(0.2 + rnd() * 0.07, 0.5, 0.75 + rnd() * 0.2) }); }
    for (let i = 0; i < 110; i++) { const p = forestSpot(100, 0.35); if (p) add(rnd() < 0.45 ? 'amanita' : 'bolete', 1, p[0], p[1], 0.8 + rnd() * 0.6, { align: 0.6 }); }
    // saplings: young spruces at forest edges / clearings (tiny instances of the real LOD'd tree kinds)
    this.stats.sapling = 0;
    for (let i = 0; i < Math.round(420 * Math.max(0.4, q.trees ?? 1)); i++) {
      const [x, z] = ring(200, 18);
      const h = heightAt(x, z); if (h < 1.2 || lakeDist(x, z) < 6 || !clear(x, z, 2)) continue;
      const cov = coverageAt(x, z, h, 0), cn = canopy(x, z);
      if (cov[1] < 0.25 || cn > 0.6 || this.world.colliders.near(x, z, 1.2).length) continue;
      const s = 0.09 + rnd() * 0.16;
      const kind = 'spruce' + ((rnd() * 4) | 0);
      m.compose(ps.set(x, h - 0.02, z), qt.setFromAxisAngle(UP, rnd() * 6.28), sc.set(s, s * (0.9 + rnd() * 0.3), s));
      WS.add(kind, m, col.setHSL(0.27, 0.35, 0.62 + rnd() * 0.15));
      if (s > 0.18) this.world.colliders.add(x, z, 0.15, 'sapling');
      this.stats.sapling++;
    }

    // ---- shoreline: reeds + cattails, pebbles, driftwood, lilies
    const reeds = [0, 1].map(() => reedClump(rnd, 18 + ((rnd() * 10) | 0), (rnd() * 4) | 0));
    // reeds: full clump near, a sparse 6-blade clump (same silhouette colour) far away
    const reedFar = [0, 1].map(() => reedClump(rnd, 6, 1));
    const nReed = reeds.length;
    reeds.forEach((r, v) => S.defineKind('reed' + v, [
      { dist: 40, parts: [{ geo: r.blades, mat: reedMat, castShadow: true }, ...(r.heads ? [{ geo: r.heads, mat: cattailMat, castShadow: true }] : [])] },
      { dist: 110, parts: [{ geo: reedFar[v].blades, mat: reedMat, castShadow: false }, { geo: reedFar[v].heads, mat: cattailMat, castShadow: false }] },
    ], { cullDist: 110 }));
    this.stats.reed = 0;
    const nPad = def('lilypad', [0].map(() => [{ geo: lilyPad(rnd), mat: padMat, castShadow: false }]), 90);
    const heart = new THREE.SphereGeometry(0.018, 8, 4); heart.scale(1, 0.6, 1); heart.translate(0, 0.035, 0);
    const nLily = def('lily', [[{ geo: lilyFlower(), mat: lilyMat, castShadow: false }, { geo: heart, mat: lilyHeart, castShadow: false }]], 70);
    const nPeb = def('pebble', [0].map(() => [{ geo: pebble(rnd), mat: pebbleMat, castShadow: false }]), 45, { fine: true });
    const nDrift = def('drift', [0, 1].map(() => [{ geo: driftwood(rnd), mat: driftMat, castShadow: true }]), 120);
    const L = WORLD.lake;
    const dockZone = (x, z) => x > -12 && x < -1 && z < -8 && z > -42;
    const shore = (dMin, dMax, tries = 60) => {
      for (let k = 0; k < tries; k++) {
        const a = rnd() * Math.PI * 2, rr = L.r * (0.5 + rnd() * 1.1);
        const x = L.x + Math.cos(a) * rr * 1.2, z = L.z + Math.sin(a) * rr;
        if (Math.hypot(x - C.x, z - C.z) > 190) continue;
        const d = lakeDist(x, z); if (d < dMin || d > dMax || dockZone(x, z)) continue;
        return [x, z, d];
      }
      return null;
    };
    // reed beds: clump along the bank, dense where shore noise is high (not a uniform ring)
    for (let i = 0; i < Math.round(1100 * gq); i++) {
      const p = shore(-6, 3); if (!p) continue;
      if (fbm(noise, p[0] * 0.04, p[1] * 0.04, 2) < -0.05) continue;
      for (let c = 0; c < 3; c++) {
        const x = p[0] + (rnd() - 0.5) * 1.6, z = p[1] + (rnd() - 0.5) * 1.6;
        if (dockZone(x, z)) continue;
        const h = heightAt(x, z);
        // by real water depth: the lakebed drops to -1.2m right at the waterline, so a lakeDist band put
        // reeds 1.4m under water with only their tips showing
        if (h < -0.45 || h > 0.9) continue;
        add('reed', nReed, x, z, 0.8 + rnd() * 0.5, { y: h, sink: 0.02, color: col.setHSL(0.17 + rnd() * 0.05, 0.35, 0.45 + rnd() * 0.2) });
      }
    }
    // lily colonies in sheltered shallows
    for (let i = 0; i < 70; i++) {
      const p = shore(-14, -1); if (!p) continue;
      const n = 6 + ((rnd() * 14) | 0);
      for (let k = 0; k < n; k++) {
        const x = p[0] + (rnd() - 0.5) * 4, z = p[1] + (rnd() - 0.5) * 4;
        const dh = heightAt(x, z); if (dh > -0.35 || dh < -2.6 || dockZone(x, z)) continue; // lilies root in 0.4-2.6m
        add('lilypad', nPad, x, z, 0.8 + rnd() * 0.6, { y: WORLD.waterLevel, color: col.setHSL(0.24 + rnd() * 0.06, 0.45, 0.35 + rnd() * 0.2) });
        if (rnd() < 0.18) add('lily', nLily, x + 0.05, z + 0.05, 1.6 + rnd() * 0.8, { y: WORLD.waterLevel });
      }
    }
    for (let i = 0; i < Math.round(2400 * gq); i++) {
      const p = shore(-2.0, 3.5); if (!p) continue;
      const g = 0.2 + rnd() * 0.22; // wet greys / browns (0.45-0.85 read as white eggs)
      add('pebble', nPeb, p[0], p[1], 0.4 + rnd() * rnd() * 2.2, { align: 1, sink: 0.012, color: col.setRGB(g * (0.95 + rnd() * 0.1), g * (0.93 + rnd() * 0.08), g * (0.88 + rnd() * 0.1)) });
    }
    for (let i = 0; i < 26; i++) { const p = shore(-0.5, 2.5); if (p) { add('drift', nDrift, p[0], p[1], 0.8 + rnd() * 0.5, { align: 1, sink: 0.03, tilt: 0.08 }); this.world.colliders.add(p[0], p[1], 0.3, 'drift'); } }

    S.build(); F.build();
    // saplings went into the world scatter: World.build() calls its build() after this
    return this;
  }

  sample(name, x, y, z) { const a = this.samples[name] || (this.samples[name] = []); if (a.length < 40) a.push([+x.toFixed(1), +y.toFixed(2), +z.toFixed(1)]); }

  update(camPos, lodBias = 1, frustum = null) { this.scatter.update(camPos, lodBias, frustum); this.fine.update(camPos, lodBias, frustum); }
}
