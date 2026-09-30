// Lane B prop toolkit: batching (merge-by-material with vertex colours), procedural textures, and small
// geometry helpers (loft, ribbon, rounded boxes, per-face material splitting, terrain conforming).
// Everything here is build-time only (no per-frame allocation).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------------------------------------------ utils
export function hash3(x, y, z, seed = 0) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.3) * 43758.5453;
  return s - Math.floor(s);
}
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
// T(x,y,z, rx,ry,rz, sx,sy,sz) -> Matrix4 (Euler XYZ unless order given)
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'XYZ') {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _s.set(sx, sy, sz));
}
// frame whose +Y follows the terrain normal (k = 0..1 blend) and yaw ry
export function groundFrame(heightAt, x, z, ry = 0, yOff = 0, k = 1) {
  const e = 0.25;
  const n = new THREE.Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  n.lerp(new THREE.Vector3(0, 1, 0), 1 - k).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) + yOff, z), q, new THREE.Vector3(1, 1, 1));
}

export function canvasTex(w, h, draw, srgb = true, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------------------------------------ batch
// Collects parts, applies transform + vertex colour (optionally per face / per vertex shading), and merges
// them into one mesh per material. Every geometry is normalised to position/normal/uv/color/aSway.
const KEEP = ['position', 'normal', 'uv', 'color', 'aSway'];
const _c = new THREE.Color(), _c2 = new THREE.Color();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(), _n = new THREE.Vector3(), _cen = new THREE.Vector3();

export class Batch {
  constructor() { this.groups = new Map(); this.stack = [new THREE.Matrix4()]; this.tris = 0; }
  // run fn with an extra local frame (nesting assemblies)
  with(m, fn) { this.stack.push(this.stack[this.stack.length - 1].clone().multiply(m)); try { fn(); } finally { this.stack.pop(); } }
  get frame() { return this.stack[this.stack.length - 1]; }

  static norm(geo) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {}; g.clearGroups();
    return g;
  }

  /**
   * add(geo, mat, m?, color?, opt?)
   *  opt.shade(p, n, out:Color)   per-vertex colour multiplier in LOCAL space (grime, soot, wear)
   *  opt.face(c, n) -> {mat,color}|mat|null   per-triangle material/colour override (local centroid/normal)
   *  opt.sway(p) -> 0..1          cloth sway weight (read by sway materials)
   */
  add(geo, mat, m = null, color = 0xffffff, opt = {}) {
    const g = Batch.norm(geo);
    // shade()/face() see assembly-space coords (after m) unless opt.local (geometry's own space)
    if (m && !opt.local) Batch.xform(g, m);
    const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
    const hasCol = !!g.attributes.color && color === null;
    const col = hasCol ? g.attributes.color.array : new Float32Array(n * 3);
    const sway = new Float32Array(n);
    const base = _c2.set(color ?? 0xffffff);
    for (let i = 0; i < n; i++) {
      _va.fromBufferAttribute(pos, i);
      // clamp: shade() noise could go negative (-0.008 on the ash) which blew up in the HDR/bloom chain
      if (!hasCol) { _c.copy(base); if (opt.shade) { _n.fromBufferAttribute(nor, i); opt.shade(_va, _n, _c); } col[i * 3] = Math.max(0, _c.r); col[i * 3 + 1] = Math.max(0, _c.g); col[i * 3 + 2] = Math.max(0, _c.b); }
      if (opt.sway) sway[i] = opt.sway(_va);
    }
    if (!hasCol) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    const late = m && opt.local ? m : null;
    if (!opt.face) { if (late) Batch.xform(g, late); this._push(g, mat); return this; }
    // per-face split into other materials / colours
    const buckets = new Map(); // mat -> [triIndex, color|null, ...]
    for (let t = 0; t < n / 3; t++) {
      _va.fromBufferAttribute(pos, t * 3); _vb.fromBufferAttribute(pos, t * 3 + 1); _vc.fromBufferAttribute(pos, t * 3 + 2);
      _cen.copy(_va).add(_vb).add(_vc).divideScalar(3);
      _n.subVectors(_vc, _vb).cross(_va.sub(_vb)).normalize();
      let r = opt.face(_cen, _n); if (r && r.isMaterial) r = { mat: r };
      const mm = r?.mat || mat;
      if (!buckets.has(mm)) buckets.set(mm, []);
      buckets.get(mm).push(t, r?.color ?? null);
    }
    for (const [mm, list] of buckets) {
      const cnt = list.length / 2, sub = new THREE.BufferGeometry();
      for (const k of KEEP) {
        const src = g.attributes[k], sz = src.itemSize, arr = new Float32Array(cnt * 3 * sz);
        for (let j = 0; j < cnt; j++) arr.set(src.array.subarray(list[j * 2] * 3 * sz, list[j * 2] * 3 * sz + 3 * sz), j * 3 * sz);
        sub.setAttribute(k, new THREE.BufferAttribute(arr, sz));
      }
      for (let j = 0; j < cnt; j++) {
        const c = list[j * 2 + 1]; if (c === null) continue;
        _c.set(c); const a = sub.attributes.color.array; // replace the colour, keep the shade() variation ratio
        for (let v = 0; v < 3; v++) { const o = (j * 3 + v) * 3; a[o] = a[o] / Math.max(base.r, 1e-3) * _c.r; a[o + 1] = a[o + 1] / Math.max(base.g, 1e-3) * _c.g; a[o + 2] = a[o + 2] / Math.max(base.b, 1e-3) * _c.b; }
      }
      if (late) Batch.xform(sub, late);
      this._push(sub, mm);
    }
    g.dispose();
    return this;
  }
  // apply a matrix to a non-indexed geometry; mirrored matrices flip the winding so faces stay front-facing
  static xform(g, M) {
    g.applyMatrix4(M);
    if (M.determinant() < 0) {
      for (const k of KEEP) { const at = g.attributes[k]; if (!at) continue; const a = at.array, s = at.itemSize; for (let t = 0; t < a.length; t += 3 * s) for (let j = 0; j < s; j++) { const x = a[t + s + j]; a[t + s + j] = a[t + 2 * s + j]; a[t + 2 * s + j] = x; } }
    }
    return g;
  }
  _push(g, mat) {
    Batch.xform(g, this.frame);
    if (!this.groups.has(mat)) this.groups.set(mat, []);
    this.groups.get(mat).push(g); this.tris += g.attributes.position.count / 3;
  }
  // snapshot of vertex counts per material (for drawRange-based progressive reveal of merged parts)
  mark() { const m = new Map(); for (const [mat, list] of this.groups) m.set(mat, list.reduce((a, g) => a + g.attributes.position.count, 0)); return m; }
  // merge -> meshes added to parent. opts per material via mat.userData: {noShadow, renderOrder}
  build(parent, name = 'batch') {
    const out = [];
    for (const [mat, list] of this.groups) {
      const geo = mergeGeometries(list, false); if (!geo) continue;
      geo.computeBoundingSphere(); geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `${name}:${mat.name || mat.type}`;
      mesh.castShadow = !mat.userData.noShadow; mesh.receiveShadow = !mat.userData.noReceive;
      if (mat.userData.renderOrder) mesh.renderOrder = mat.userData.renderOrder;
      parent.add(mesh); out.push(mesh);
      for (const g of list) g.dispose();
    }
    this.groups.clear();
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ geometry
export const box = (w, h, d, ws = 1, hs = 1, ds = 1) => new THREE.BoxGeometry(w, h, d, ws, hs, ds);
export const rbox = (w, h, d, r = 0.01, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
export const cyl = (rt, rb, h, seg = 12, hs = 1, open = false, t0 = 0, tl = Math.PI * 2) => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open, t0, tl);
export const sphere = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
export const torus = (R, r, rs = 6, ts = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const lathe = (pts, seg = 24, phi0 = 0, phiL = Math.PI * 2) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y)), seg, phi0, phiL);
export const tube = (pts, r = 0.01, seg = 24, rad = 6, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed), seg, r, rad, closed);
// thin-walled lathe (vessel): outer profile, wall thickness, rolled rim
export function vessel(outer, wall = 0.002, seg = 28) {
  const pts = outer.map(([r, y]) => [r, y]);
  const inner = outer.slice().reverse().map(([r, y]) => [Math.max(0, r - wall), Math.max(outer[0][1] + wall, y)]);
  const top = outer[outer.length - 1];
  return lathe([...pts, [top[0] - wall * 0.5, top[1] + wall * 0.6], ...inner], seg);
}
// loft: tube along a path with an elliptical/profiled cross section. rf(t, a) -> [rx, ry] (radius in the
// frame's normal/binormal directions); closed caps optional.
export function loft(path, rf, seg = 24, rad = 16, caps = true) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const fr = curve.computeFrenetFrames(seg, false);
  const pos = [], uv = [], idx = [], P = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, P);
    const N = fr.normals[i], Bn = fr.binormals[i];
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2; const [rx, ry] = rf(t, a);
      pos.push(P.x + N.x * Math.cos(a) * rx + Bn.x * Math.sin(a) * ry, P.y + N.y * Math.cos(a) * rx + Bn.y * Math.sin(a) * ry, P.z + N.z * Math.cos(a) * rx + Bn.z * Math.sin(a) * ry);
      uv.push(j / rad, t);
    }
  }
  // winding: (along T) x (around N->B) = -N was inward -> sides rendered inside-out (black handles/roots)
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  if (caps) for (const [i, flip] of [[0, true], [seg, false]]) {
    curve.getPointAt(i / seg, P); const c = pos.length / 3; pos.push(P.x, P.y, P.z); uv.push(0.5, 0.5);
    for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j; if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// flat strap/ribbon along a path: width w along `side` (projected orthogonal to the tangent), thickness t
export function ribbon(path, w = 0.03, t = 0.003, seg = 20, side = new THREE.Vector3(1, 0, 0)) {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))));
  const pos = [], uv = [], idx = [], P = new THREE.Vector3(), Tn = new THREE.Vector3(), S = new THREE.Vector3(), N = new THREE.Vector3();
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg; curve.getPointAt(u, P); curve.getTangentAt(u, Tn);
    S.copy(side).addScaledVector(Tn, -side.dot(Tn)); if (S.lengthSq() < 1e-8) S.set(0, 1, 0); S.normalize(); N.crossVectors(Tn, S).normalize();
    for (const [a, b] of corners) { pos.push(P.x + S.x * a * w / 2 + N.x * b * t / 2, P.y + S.y * a * w / 2 + N.y * b * t / 2, P.z + S.z * a * w / 2 + N.z * b * t / 2); uv.push((a + 1) / 2, u * 4); }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// vertical sweep with a superellipse cross-section: fn(t) -> { rx, rz, cx=0, cz=0, n=2 }. Caps top/bottom.
export function sweepY(y0, y1, fn, seg = 16, rad = 24, caps = true) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = y0 + (y1 - y0) * t, f = fn(t); const n = f.n || 2;
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), ez = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
      pos.push((f.cx || 0) + ex * f.rx, y, (f.cz || 0) + ez * f.rz); uv.push(j / rad, t);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  if (caps) for (const [i, top] of [[0, false], [seg, true]]) {
    const f = fn(i / seg), c = pos.length / 3; pos.push(f.cx || 0, y0 + (y1 - y0) * (i / seg), f.cz || 0); uv.push(0.5, 0.5);
    for (let j = 0; j < rad; j++) { const a = i * (rad + 1) + j; if (top) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// split firewood piece: pie-slice prism along +z (length len), angle `ang` of a log of radius r.
// End caps get end-grain uvs (0..1 across the full log diameter). Use pieFace() to assign materials.
export function pie(r, len, ang = Math.PI / 2, a0 = 0, seg = 6, seed = 0) {
  const sh = new THREE.Shape(); const rnd = rng(seed * 31 + 7);
  const inner = ang >= Math.PI * 1.99 ? null : 0.0;
  if (inner === null) { sh.absarc(0, 0, r, 0, Math.PI * 2, false); }
  else { sh.moveTo(Math.cos(a0 + ang / 2) * r * 0.06, Math.sin(a0 + ang / 2) * r * 0.06); for (let i = 0; i <= seg; i++) { const a = a0 + ang * (i / seg), rr = r * (0.97 + rnd() * 0.05); sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } sh.closePath(); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: seg * 2 });
  g.translate(0, 0, -len / 2);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getZ(i)) > 0.9) uv.setXY(i, p.getX(i) / (2 * r) + 0.5, p.getY(i) / (2 * r) + 0.5);
    else uv.setXY(i, Math.atan2(p.getY(i), p.getX(i)) * r * 2, (p.getZ(i) / len + 0.5) * len * 1.5);
  }
  return g;
}
// material picker for pie(): end caps -> end, outer arc -> bark, split faces -> split
export const pieFace = (end, bark, split, splitColor = 0xd9b98a) => (c, n) => {
  if (Math.abs(n.z) > 0.9) return end;
  const l = Math.hypot(c.x, c.y) || 1;
  return (c.x * n.x + c.y * n.y) / l > 0.6 ? bark : { mat: split, color: splitColor };
};
// catenary-ish sagging line between two points
export function sagPoints(a, b, sag, n = 16) {
  const A = a.isVector3 ? a : new THREE.Vector3(...a), Bv = b.isVector3 ? b : new THREE.Vector3(...b), out = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const p = A.clone().lerp(Bv, t); p.y -= Math.sin(Math.PI * t) * sag; out.push(p); }
  return out;
}
// radial noise displacement from the geometry centre (irregular organic shapes). Depends on position only,
// so coincident vertices (uv seams, non-indexed faces) move identically and no cracks open.
export function jitter(geo, amt = 0.01, freq = 1, seed = 0, yMul = 1) {
  const p = geo.attributes.position, d = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const q = (v) => Math.round(v * 1e4) / 1e4;
    const h = hash3(q(x) * freq, q(y) * freq, q(z) * freq, seed) - 0.5;
    d.set(x, y * yMul, z); const l = d.length() || 1; d.divideScalar(l);
    p.setXYZ(i, x + d.x * h * amt, y + d.y * h * amt, z + d.z * h * amt);
  }
  geo.computeVertexNormals(); return geo;
}
// remap uvs into an atlas rectangle
export function uvRect(geo, u0, v0, u1, v1) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0)); return geo; }
export function uvScale(geo, su, sv = su) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return geo; }
// conform a world-space geometry's vertices to the terrain (decals, groundsheets)
export function conform(geo, heightAt, lift = 0.01) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) + lift + p.getY(i)); geo.computeVertexNormals(); return geo; }

// ------------------------------------------------------------------------------------------------ textures
let _tex = null;
export function kitTextures() {
  if (_tex) return _tex;
  const R = rng(77);
  // generic wood grain (neutral, tinted by vertex colour)
  const grain = canvasTex(256, 1024, (g, w, h) => {
    g.fillStyle = '#c9a57a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) { const x = R() * w, a = 0.05 + R() * 0.18; g.strokeStyle = R() > 0.5 ? `rgba(90,55,25,${a})` : `rgba(255,235,200,${a * 0.6})`; g.lineWidth = 0.6 + R() * 2.2; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.01 + i) * 6 + (R() - 0.5) * 2, y); g.stroke(); }
    for (let i = 0; i < 7; i++) { const x = R() * w, y = R() * h, r = 4 + R() * 9; const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.5); gr.addColorStop(0, 'rgba(60,32,12,0.75)'); gr.addColorStop(0.4, 'rgba(90,55,25,0.35)'); gr.addColorStop(1, 'rgba(90,55,25,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 2.6, 0, 0, 7); g.fill(); }
  });
  // end grain rings + radial checks (cracks)
  const endgrain = canvasTex(512, 512, (g, w) => {
    const c = w / 2; g.fillStyle = '#c8a070'; g.fillRect(0, 0, w, w);
    for (let r = 250; r > 3; r -= 3 + R() * 7) { g.strokeStyle = `rgba(110,70,35,${0.2 + R() * 0.35})`; g.lineWidth = 1 + R() * 2.2; g.beginPath(); for (let a = 0; a <= 6.3; a += 0.1) { const rr = r * (1 + Math.sin(a * 3 + r) * 0.015); g.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr); } g.stroke(); }
    const pith = g.createRadialGradient(c, c, 0, c, c, 22); pith.addColorStop(0, 'rgba(80,45,20,0.9)'); pith.addColorStop(1, 'rgba(80,45,20,0)'); g.fillStyle = pith; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(40,22,10,0.8)'; for (let i = 0; i < 6; i++) { const a = R() * 6.28, l = 60 + R() * 150; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * 240, c + Math.sin(a) * 240); g.lineTo(c + Math.cos(a + 0.02) * (240 - l), c + Math.sin(a + 0.02) * (240 - l)); g.stroke(); }
    // sapwood + bark ring
    g.strokeStyle = 'rgba(230,200,150,0.35)'; g.lineWidth = 14; g.beginPath(); g.arc(c, c, 232, 0, 7); g.stroke();
    g.strokeStyle = '#3a2716'; g.lineWidth = 16; g.beginPath(); g.arc(c, c, 252, 0, 7); g.stroke();
    // saw marks
    g.globalAlpha = 0.08; g.strokeStyle = '#000'; for (let i = 0; i < 40; i++) { g.lineWidth = 1; g.beginPath(); g.arc(-600, c, 700 + i * 9, -0.5, 0.5); g.stroke(); } g.globalAlpha = 1;
  }, true, false);
  // fabric weave normal map (tiling) + roughness-ish detail
  const weaveN = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const o = ((x + y) / 4) % 2; g.fillStyle = o ? 'rgb(150,128,240)' : 'rgb(128,150,240)'; g.fillRect(x, y, 2, 2); g.fillStyle = o ? 'rgb(106,128,240)' : 'rgb(128,106,240)'; g.fillRect(x + 2, y + 2, 2, 2); }
  }, false);
  // canvas / cotton colour noise (neutral grey, multiplied by vertex colour)
  const cloth = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16000; i++) { g.fillStyle = `rgba(${R() > 0.5 ? '255,255,255' : '0,0,0'},${R() * 0.07})`; g.fillRect(R() * w, R() * h, 1 + R() * 2, 1); }
    for (let i = 0; i < 30; i++) { const x = R() * w, y = R() * h, r = 20 + R() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,55,40,0.07)'); gr.addColorStop(1, 'rgba(70,55,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  });
  // metal: brushed streaks + fine scratches (roughness map, linear)
  const brushedR = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(90,90,90)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { const y = R() * h; g.strokeStyle = `rgba(${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},0.08)`; g.fillStyle = R() > 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'; g.fillRect(0, y, w, 1); }
    g.strokeStyle = 'rgba(200,200,200,0.35)'; for (let i = 0; i < 40; i++) { const x = R() * w, y = R() * h; g.lineWidth = 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 40); g.stroke(); }
  }, false);
  // grunge (dirt / wear) colour map, neutral white with darker blotches: multiplies painted surfaces
  const grunge = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const x = R() * w, y = R() * h, r = 8 + R() * 50; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(120,105,85,${0.05 + R() * 0.12})`); gr.addColorStop(1, 'rgba(120,105,85,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
    for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(90,80,70,${R() * 0.12})`; g.fillRect(R() * w, R() * h, 1, 1); }
  });
  // soft round contact shadow (alpha)
  const aoDisc = canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  }, false, false);
  // rope: twisted strand stripes
  const rope = canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, w, h);
    for (let y = -w; y < h + w; y += 10) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + w * 0.6); g.stroke(); g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, y + 4); g.lineTo(w, y + 4 + w * 0.6); g.stroke(); }
  });
  _tex = { grain, endgrain, weaveN, cloth, brushedR, grunge, aoDisc, rope };
  return _tex;
}

// shared materials (vertex coloured, one draw call per material after batching)
let _mats = null;
export function kitMaterials(textures) {
  if (_mats) {
    // first caller may have had no textures (buildChair/buildLantern): upgrade the cached bark later instead of
    // keeping the plain-grain fallback forever
    const bk = textures?.bark_brown_02;
    if (bk?.diff && _mats.bark.map !== bk.diff) { _mats.bark.map = bk.diff; _mats.bark.normalMap = bk.nor || null; _mats.bark.needsUpdate = true; }
    return _mats;
  }
  const t = kitTextures();
  const bk = textures?.bark_brown_02;
  const mats = {
    paint: new THREE.MeshStandardMaterial({ name: 'paint', vertexColors: true, map: t.grunge, roughness: 0.55, metalness: 0 }),
    plastic: new THREE.MeshPhysicalMaterial({ name: 'plastic', vertexColors: true, map: t.grunge, roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    enamel: new THREE.MeshPhysicalMaterial({ name: 'enamel', vertexColors: true, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.15 }),
    metal: new THREE.MeshStandardMaterial({ name: 'metal', vertexColors: true, roughnessMap: t.brushedR, roughness: 0.7, metalness: 1 }),
    iron: new THREE.MeshStandardMaterial({ name: 'iron', vertexColors: true, map: t.grunge, roughness: 0.78, metalness: 0.65 }),
    wood: new THREE.MeshStandardMaterial({ name: 'wood', vertexColors: true, map: t.grain, roughness: 0.72 }),
    endgrain: new THREE.MeshStandardMaterial({ name: 'endgrain', vertexColors: true, map: t.endgrain, roughness: 0.9 }),
    bark: new THREE.MeshStandardMaterial({ name: 'bark', vertexColors: true, map: bk?.diff || t.grain, normalMap: bk?.nor || null, roughness: 1 }),
    fabric: new THREE.MeshStandardMaterial({ name: 'fabric', vertexColors: true, map: t.cloth, normalMap: t.weaveN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.88, side: THREE.DoubleSide }),
    rope: new THREE.MeshStandardMaterial({ name: 'rope', vertexColors: true, map: t.rope, roughness: 0.95 }),
    rubber: new THREE.MeshStandardMaterial({ name: 'rubber', vertexColors: true, map: t.grunge, roughness: 0.92 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0xffffff, roughness: 0.04, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }),
    ao: new THREE.MeshBasicMaterial({ name: 'ao', color: 0x000000, alphaMap: t.aoDisc, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  mats.glass.userData.noShadow = true;
  mats.ao.userData.noShadow = true; mats.ao.userData.noReceive = true; mats.ao.userData.renderOrder = 1;
  _mats = mats;
  return mats;
}

// cloth that sways in the wind: weight from the aSway attribute (0 at the attached edge)
export function swayMaterial(base, U) {
  const m = base.clone(); m.name = (base.name || 'm') + '-sway';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSway; uniform float uTime; uniform vec2 uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wl = length(uWind);
        float gust = 0.55 + 0.45 * sin(uTime * 0.9 + position.x * 0.7) * sin(uTime * 0.37 + position.z * 0.5);
        float fl = sin(uTime * 3.1 + position.x * 5.0 + position.y * 7.0) * 0.35 + sin(uTime * 5.3 + position.z * 6.0) * 0.2;
        transformed += vec3(uWind.x, 0.0, uWind.y) * aSway * (0.05 * gust + 0.018 * fl) * min(wl, 1.5);
        transformed.y += aSway * aSway * 0.012 * fl * wl;`);
  };
  m.customProgramCacheKey = () => 'kit-sway';
  return m;
}

// helper: contact shadow disc (world space, conformed to terrain)
export function aoDecal(batch, mats, heightAt, x, z, rx, rz = rx, ry = 0, strength = 1) {
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2, 6, 6); g.rotateX(-Math.PI / 2); g.rotateY(ry); g.translate(x, 0, z);
  conform(g, heightAt, 0.012);
  const c = Math.round(255 * Math.min(1, strength));
  batch.add(g, mats.ao, null, (c << 16) | (c << 8) | c);
}

// smooth normals for non-indexed geometry (Icosahedron/Polyhedron, ExtrudeGeometry...): average face normals of
// all vertices sharing a (quantised) position. computeVertexNormals() on such geometry gives flat facets.
export function smoothNormals(geo, q = 1e4) {
  const p = geo.attributes.position; geo.computeVertexNormals(); const n = geo.attributes.normal;
  const acc = new Map(), key = (i) => `${Math.round(p.getX(i) * q)},${Math.round(p.getY(i) * q)},${Math.round(p.getZ(i) * q)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); const a = acc.get(k) || [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(k, a); }
  for (let i = 0; i < p.count; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l); }
  n.needsUpdate = true; return geo;
}
