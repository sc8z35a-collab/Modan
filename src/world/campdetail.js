// Lane B: camp detail props. Everything static is merged per material through propkit's Batch, so the ~40
// extra objects cost ~15 draw calls (+ shadow). All sizes are real-world metres.
//
// export function buildCampDetails(ctx) -> { group, update(dt, info), colliders:[] }
//   ctx = { scene, textures, U, heightAt, colliders, camp:{x,z}, tentPos, firePos,
//           tent?, tentOrigin?:{x,z}, tentRot?, table?, dock?, dockEnd? }
import * as THREE from 'three';
import { WORLD } from './heightfield.js';
import { PATH_PTS } from './terrain.js';
import {
  Batch, T, rng, smoothNormals, canvasTex, kitMaterials, kitTextures, swayMaterial,
  box, rbox, cyl, sphere, torus, lathe, tube, vessel, loft, ribbon, sweepY, pie, pieFace, sagPoints, jitter, uvScale,
} from './propkit.js';
import { settleToGround } from './props.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// vertex shaders for batch.add(..., { shade })
const grime = (h = 0.06, k = 0.45, tint = [0.62, 0.55, 0.45]) => (p, n, c) => {
  const t = 1 - smooth(0, h, p.y); c.r *= 1 - t * k * (1 - tint[0]); c.g *= 1 - t * k * (1 - tint[1]); c.b *= 1 - t * k * (1 - tint[2]);
};
const soot = (y0, y1, k = 0.85) => (p, n, c) => { const t = 1 - smooth(y0, y1, p.y); c.multiplyScalar(1 - t * k); };
const edgeWear = (k = 0.2) => (p, n, c) => { const e = Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z); c.multiplyScalar(1 + (e - 1) * k); };

// ---------------------------------------------------------------------------------------------- items
// Each builder works in a local frame: origin on the ground, +y up, gh(lx,lz) = local terrain height.

function aoLocal(B, M, gh, x, z, rx, rz = rx, ry = 0, k = 1) {
  const g = new THREE.PlaneGeometry(rx * 2, rz * 2, 6, 6); g.rotateX(-Math.PI / 2); g.rotateY(ry); g.translate(x, 0, z);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, gh(p.getX(i), p.getZ(i)) + 0.008);
  const c = Math.round(255 * Math.min(1, k)); B.add(g, M.ao, null, (c << 16) | (c << 8) | c);
}

// radial displacement by angle/height (shared by side + cap so they stay welded)
function radial(geo, f) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x), k = f(a, p.getY(i)); p.setX(i, x * k); p.setZ(i, z * k); }
  geo.computeVertexNormals(); return geo;
}

// --- axe (shared by the chopping block; the held axe in props.js uses the same proportions)
export function addAxe(B, M, m) {
  B.with(m, () => {
    // hickory handle with a slight S-curve and swell at the grip
    const hp = []; for (let i = 0; i <= 10; i++) { const t = i / 10; hp.push(V3(Math.sin(t * Math.PI) * 0.012 - t * 0.01, t * 0.72, 0)); }
    B.add(loft(hp, (t) => { const r = 0.0165 + 0.004 * Math.exp(-((t - 0.04) ** 2) / 0.002) - 0.003 * smooth(0.6, 0.9, t); return [r * 1.25, r * 0.85]; }, 20, 10), M.wood, null, 0xc79a62, { shade: (p, n, c) => { const t = 1 - smooth(0.02, 0.3, p.y); c.multiplyScalar(1 - t * 0.35); } });
    // head: wedge profile (thick at the eye, thin at the edge), forged dark, bright bevel along the edge
    const s = new THREE.Shape();
    s.moveTo(-0.045, 0.028); s.lineTo(0.02, 0.03); s.bezierCurveTo(0.08, 0.035, 0.12, 0.07, 0.165, 0.085); s.quadraticCurveTo(0.185, 0.0, 0.165, -0.085);
    s.bezierCurveTo(0.12, -0.06, 0.08, -0.035, 0.02, -0.03); s.lineTo(-0.045, -0.028); s.closePath();
    const hg = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 2, curveSegments: 10 });
    hg.translate(0, 0, -0.01);
    // taper toward the cutting edge
    const p = hg.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), k = 1 - 0.8 * smooth(0.02, 0.17, x); p.setZ(i, p.getZ(i) * k); }
    hg.computeVertexNormals();
    B.add(hg, M.iron, T(0, 0.66, 0, 0, 0, 0), 0x3a3c3e, { shade: (q, n, c) => { const e = smooth(0.14, 0.175, q.x); c.lerp(new THREE.Color(0xd8dde2), e); } });
    // wedge in the eye
    B.add(box(0.006, 0.004, 0.028), M.metal, T(-0.012, 0.723, 0), 0x9a9ea2);
  });
}

function choppingBlock(B, M, R, gh) {
  const h = 0.44, r = 0.23;
  const f = (a, y) => 1 + 0.045 * Math.sin(a * 3 + 1.3) + 0.03 * Math.sin(a * 7 + 0.4) + 0.08 * (1 - smooth(0, 0.12, y));
  const side = uvScale(radial(cyl(r, r, h, 28, 6, true).translate(0, h / 2 - 0.03, 0), f), 3, 1);
  B.add(side, M.bark, null, 0x8f7f70, { shade: grime(0.1, 0.5) });
  const top = radial(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2).translate(0, h - 0.03, 0), (a) => f(a, h));
  B.add(top, M.endgrain, null, 0xb7a38c);
  // axe cuts in the top (dark wedges)
  // old axe cuts in the top: thin dark kerfs with a lighter bruised rim
  for (let i = 0; i < 4; i++) { const x = (R() - 0.5) * 0.16, z = (R() - 0.5) * 0.16, ry = R() * 3, l = 0.07 + R() * 0.07; B.add(box(l, 0.002, 0.0025), M.endgrain, T(x, h - 0.0295, z, 0, ry, 0), 0x6a4f35); B.add(box(l * 1.1, 0.001, 0.009), M.endgrain, T(x, h - 0.0298, z, 0, ry, 0), 0xcdb89a); }
  // roots flaring into the ground
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + R() * 0.5, c = Math.cos(a), s = Math.sin(a);
    B.add(loft([[c * r * 0.85, 0.12, s * r * 0.85], [c * (r + 0.07), 0.035, s * (r + 0.07)], [c * (r + 0.2), gh(c * (r + 0.2), s * (r + 0.2)) - 0.02, s * (r + 0.2)]], (t) => [0.055 * (1 - t) + 0.012, 0.04 * (1 - t) + 0.01], 8, 8), M.bark, null, 0x7d6f62, { shade: grime(0.08, 0.5) });
  }
  // axe buried in the top: blade edge 3cm into the wood, handle rising toward the grip
  // rotate so the blade points down (-y) and the handle rises ~30deg: z-rot of -(PI/2 - 0.5)
  const th = -(Math.PI / 2 - 0.52); const m = T(0, 0, 0, 0, 0, th);
  const edge = V3(0.17, 0.66, 0).applyMatrix4(m);
  addAxe(B, M, T(0, 0, 0, 0, 0.5, 0).multiply(T(-0.02 - edge.x, h - 0.03 - 0.028 - edge.y, 0)).multiply(m));
  // wood chips + bark flakes around
  for (let i = 0; i < 46; i++) {
    const a = R() * Math.PI * 2, d = r + 0.05 + Math.pow(R(), 1.5) * 0.9, x = Math.cos(a) * d, z = Math.sin(a) * d;
    const bark = R() < 0.3;
    B.add(box(0.02 + R() * 0.05, 0.004 + R() * 0.004, 0.012 + R() * 0.025), bark ? M.bark : M.wood, T(x, gh(x, z) + 0.003, z, (R() - 0.5) * 0.4, R() * 6.28, (R() - 0.5) * 0.4), bark ? 0x6b5a4a : [0xe0c49a, 0xd4b284, 0xc9a67a][i % 3]);
  }
  aoLocal(B, M, gh, 0, 0, 0.42, 0.42, 0, 0.9);
}

function cooler(B, M, R, gh) {
  const W = 0.6, D = 0.38, H = 0.3, L = 0.07, y0 = 0.018;
  const blue = 0x2d6f96, white = 0xe8e4d8, grey = 0x3a3d40;
  B.add(rbox(W, H, D, 0.035, 3), M.plastic, T(0, y0 + H / 2, 0), blue, { shade: (p, n, c) => { grime(0.08, 0.5)(p, n, c); } });
  B.add(rbox(W + 0.014, L, D + 0.014, 0.028, 3), M.plastic, T(0, y0 + H + L / 2 + 0.004, 0), white, { shade: (p, n, c) => { if (n.y > 0.9) c.multiplyScalar(0.97); } });
  B.add(box(W - 0.02, 0.006, D - 0.02), M.rubber, T(0, y0 + H + 0.002, 0), 0x151515); // lid seal gap
  // lid top: two moulded cup holders + fish ruler
  for (const x of [-0.2, -0.1]) B.add(cyl(0.038, 0.034, 0.012, 20), M.plastic, T(x, y0 + H + L + 0.0, 0.09), 0xb8b4a8);
  B.add(box(0.36, 0.002, 0.03), M.paint, T(0.09, y0 + H + L + 0.005, -0.12), 0xd8d2c0);
  for (let i = 0; i <= 18; i++) B.add(box(0.0015, 0.0015, i % 5 ? 0.008 : 0.016), M.paint, T(-0.09 + i * 0.02, y0 + H + L + 0.0065, -0.13), 0x222222);
  // side handles (swing handles on pivots)
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.004);
    for (const z of [-0.085, 0.085]) B.add(cyl(0.012, 0.012, 0.012, 12), M.plastic, T(x, y0 + H - 0.05, z, 0, 0, Math.PI / 2), white);
    B.add(tube([[x, y0 + H - 0.05, -0.085], [x + sx * 0.014, y0 + H - 0.1, -0.075], [x + sx * 0.016, y0 + H - 0.115, 0], [x + sx * 0.014, y0 + H - 0.1, 0.075], [x, y0 + H - 0.05, 0.085]], 0.0065, 20, 6), M.plastic, null, grey);
  }
  // front latches + hinge line on the back + drain plug
  for (const x of [-0.18, 0.18]) { B.add(rbox(0.05, 0.06, 0.014, 0.004), M.plastic, T(x, y0 + H + 0.005, D / 2 + 0.012), white); B.add(box(0.03, 0.008, 0.004), M.rubber, T(x, y0 + H - 0.018, D / 2 + 0.02), 0x222222); }
  B.add(cyl(0.008, 0.008, W - 0.1, 10), M.plastic, T(0, y0 + H + 0.006, -D / 2 - 0.008, 0, 0, Math.PI / 2), white);
  B.add(cyl(0.016, 0.018, 0.02, 14), M.plastic, T(W / 2 - 0.07, y0 + 0.04, D / 2 + 0.006, Math.PI / 2, 0, 0), white);
  B.add(cyl(0.006, 0.006, 0.012, 8), M.plastic, T(W / 2 - 0.07, y0 + 0.04, D / 2 + 0.02, Math.PI / 2, 0, 0), grey);
  // feet
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add(rbox(0.07, y0 + 0.004, 0.05, 0.006), M.rubber, T(sx * (W / 2 - 0.06), y0 / 2, sz * (D / 2 - 0.045)), 0x1c1c1c);
  // badge
  B.add(rbox(0.13, 0.04, 0.004, 0.0015), M.enamel, T(-0.12, y0 + H - 0.06, D / 2 + 0.001), 0xc23a2a);
  aoLocal(B, M, gh, 0, 0, W * 0.72, D * 0.8, 0, 1);
}

function waterJug(B, M, R, gh) {
  const blue = 0x2f6fb0;
  const body = sweepY(0.0, 0.34, (t) => ({ rx: 0.13 - 0.02 * smooth(0.85, 1, t), rz: 0.095 - 0.015 * smooth(0.85, 1, t), n: 3.2 }), 10, 28);
  B.add(body, M.plastic, null, blue, { shade: (p, n, c) => { grime(0.05, 0.4)(p, n, c); if (Math.abs(p.x) < 0.1 && Math.abs(n.z) > 0.8) c.multiplyScalar(0.94); } });
  // grip ridges
  for (let i = 0; i < 4; i++) B.add(box(0.2, 0.006, 0.006), M.plastic, T(0, 0.08 + i * 0.05, 0.096), 0x28609a);
  // moulded handle bridge on top
  B.add(tube([[-0.07, 0.33, 0], [-0.06, 0.39, 0], [0.0, 0.405, 0], [0.06, 0.39, 0], [0.07, 0.33, 0]], 0.013, 20, 8), M.plastic, null, blue);
  // screw cap + vent + spigot
  B.add(cyl(0.028, 0.03, 0.03, 18), M.plastic, T(0.085, 0.35, 0.04), 0xe6e0d0);
  for (let i = 0; i < 12; i++) B.add(box(0.003, 0.028, 0.004), M.plastic, T(0.085 + Math.cos(i / 12 * 6.28) * 0.03, 0.35, 0.04 + Math.sin(i / 12 * 6.28) * 0.03, 0, -i / 12 * 6.28, 0), 0xd0cab8);
  B.add(cyl(0.008, 0.008, 0.012, 10), M.plastic, T(-0.09, 0.345, -0.04), 0x222222);
  B.add(cyl(0.012, 0.012, 0.05, 12), M.plastic, T(0, 0.06, 0.12, Math.PI / 2, 0, 0), 0xe6e0d0);
  B.add(cyl(0.007, 0.009, 0.03, 10), M.plastic, T(0, 0.045, 0.14), 0xe6e0d0);
  B.add(rbox(0.03, 0.01, 0.016, 0.003), M.plastic, T(0, 0.075, 0.14), 0xd04020);
  // water level visible through the translucent wall: darker band below the fill line
  B.add(sweepY(0.005, 0.2, () => ({ rx: 0.1285, rz: 0.0935, n: 3.2 }), 1, 28, false), M.glass, null, 0x9fc7ea);
  aoLocal(B, M, gh, 0, 0, 0.2, 0.15, 0, 0.9);
}

function stool(B, M, R, gh) {
  // tripod stool: three beech legs through a brass pivot, leather triangle seat
  const top = [], H = 0.43;
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, b = a + Math.PI;
    const g0 = V3(Math.cos(a) * 0.2, gh(Math.cos(a) * 0.2, Math.sin(a) * 0.2), Math.sin(a) * 0.2), t0 = V3(Math.cos(b) * 0.15, H, Math.sin(b) * 0.15);
    top.push(t0);
    B.add(loft([g0, g0.clone().lerp(t0, 0.5), t0], (t) => [0.012 - 0.002 * t, 0.012 - 0.002 * t], 6, 8), M.wood, null, 0xd8b88a, { shade: grime(0.05, 0.5) });
    B.add(cyl(0.013, 0.011, 0.02, 8), M.rubber, T(g0.x, g0.y + 0.008, g0.z), 0x1a1a1a);
  }
  B.add(sphere(0.02, 12, 8), M.metal, T(0, H / 2, 0, 0, 0, 0, 1, 1.4, 1), 0xc9a15a);
  // sagging leather triangle
  const g = new THREE.BufferGeometry(), pos = [], uv = [], idx = [], N = 10;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
    const u = i / N, v = j / N, w = 1 - u - v;
    const p = top[0].clone().multiplyScalar(u).addScaledVector(top[1], v).addScaledVector(top[2], w);
    p.y += 0.012 - 0.05 * (u * v * w) * 27 * 0.6; pos.push(p.x, p.y, p.z); uv.push(u, v);
  }
  const id = (i, j) => { let k = 0; for (let a = 0; a < i; a++) k += N - a + 1; return k + j; };
  for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) { idx.push(id(i, j), id(i + 1, j), id(i, j + 1)); if (j < N - i - 1) idx.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  B.add(g, M.fabric, null, 0x6a3f22);
  for (const t of top) B.add(sphere(0.012, 8, 6), M.metal, T(t.x, t.y + 0.012, t.z), 0xc9a15a);
  aoLocal(B, M, gh, 0, 0, 0.3, 0.3, 0, 0.6);
}

function backpack(B, M, R, gh) {
  const body = 0xa8472c, dark = 0x2a2c2f, H = 0.62;
  // main bag (back panel at -z)
  B.add(sweepY(0.02, H, (t) => ({ rx: 0.155 + 0.01 * Math.sin(t * Math.PI), rz: 0.1 + 0.03 * Math.sin(t * Math.PI * 0.9), cz: 0.02 * Math.sin(t * Math.PI), n: 3 }), 14, 28), M.fabric, null, body, { shade: (p, n, c) => { grime(0.12, 0.45)(p, n, c); if (p.z < -0.08) c.multiplyScalar(0.55); } });
  // lid pocket draped over the top
  B.add(sweepY(H - 0.04, H + 0.05, (t) => ({ rx: 0.165 - 0.03 * t, rz: 0.125 - 0.03 * t, cz: 0.02, n: 2.6 }), 5, 24), M.fabric, null, 0x8c3a24);
  B.add(ribbon([[-0.14, H + 0.02, 0.13], [0, H + 0.03, 0.14], [0.14, H + 0.02, 0.13]], 0.004, 0.006, 12), M.rubber, null, 0x111111); // zipper
  // front stretch pocket
  B.add(sweepY(0.1, 0.42, (t) => ({ rx: 0.12, rz: 0.03 + 0.01 * Math.sin(t * Math.PI), cz: 0.12, n: 3 }), 6, 20), M.fabric, null, 0x3b3e42);
  // side bottle pocket with a steel bottle
  B.add(sweepY(0.05, 0.25, () => ({ rx: 0.035, rz: 0.045, cx: 0.17, cz: 0.02, n: 2.4 }), 3, 14), M.fabric, null, 0x3b3e42);
  B.add(cyl(0.033, 0.033, 0.24, 18), M.metal, T(0.175, 0.19, 0.02), 0xb8bcc0);
  B.add(cyl(0.022, 0.026, 0.04, 14), M.plastic, T(0.175, 0.33, 0.02), 0x222222);
  // compression straps + buckles
  for (const y of [0.22, 0.44]) for (const sx of [-1, 1]) {
    B.add(ribbon([[sx * 0.16, y, -0.07], [sx * 0.172, y, 0.02], [sx * 0.12, y, 0.14], [sx * 0.04, y, 0.16]], 0.022, 0.003, 10, V3(0, 1, 0)), M.fabric, null, dark);
    B.add(rbox(0.03, 0.026, 0.008, 0.003), M.plastic, T(sx * 0.03, y, 0.162), 0x111111);
  }
  // shoulder straps on the back panel (padded, curving down)
  for (const sx of [-1, 1]) B.add(ribbon([[sx * 0.07, H - 0.03, -0.12], [sx * 0.08, H - 0.12, -0.155], [sx * 0.095, 0.35, -0.16], [sx * 0.12, 0.16, -0.14], [sx * 0.14, 0.08, -0.1]], 0.055, 0.018, 16), M.fabric, null, dark);
  // hip belt wings
  for (const sx of [-1, 1]) B.add(ribbon([[sx * 0.1, 0.1, -0.13], [sx * 0.2, 0.09, -0.08], [sx * 0.23, 0.08, 0.02]], 0.08, 0.02, 8, V3(0, 1, 0)), M.fabric, null, dark);
  // haul loop + ice axe loop + carabiner with an enamel mug
  B.add(torus(0.02, 0.005, 5, 12, Math.PI), M.fabric, T(0, H + 0.04, -0.1, 0, 0, 0), dark);
  B.add(torus(0.022, 0.004, 6, 14), M.metal, T(-0.09, 0.47, 0.18, 0, Math.PI / 2, 0, 1, 1.5, 1), 0xd8a030);
  const mug = vessel([[0.001, 0], [0.04, 0], [0.042, 0.004], [0.043, 0.07], [0.044, 0.075]], 0.002, 24);
  B.add(mug, M.enamel, T(-0.09, 0.36, 0.23, 0.25, 0, 0.15), 0xeeeae0, { local: true, shade: (p, n, c) => { if (p.y > 0.066) c.setRGB(0.05, 0.12, 0.3); } });
  B.add(torus(0.022, 0.0045, 6, 12, Math.PI), M.enamel, T(-0.09, 0.4, 0.21, 0.25, Math.PI / 2, Math.PI / 2 + 0.15), 0xeeeae0);
  // foam sleeping mat strapped under the bag
  B.add(cyl(0.075, 0.075, 0.5, 20, 1).rotateZ(Math.PI / 2), M.plastic, T(0, 0.075, 0.03), 0x7a8f3c, { shade: (p, n, c) => { if (Math.abs(p.x) > 0.245) c.multiplyScalar(0.8); } });
  for (let k = 0; k < 6; k++) B.add(torus(0.075 - k * 0.011, 0.0012, 3, 20), M.plastic, T(0.2505, 0.075, 0.03, 0, Math.PI / 2, 0), 0x55682a);
  for (const x of [-0.16, 0.16]) B.add(torus(0.078, 0.004, 4, 20), M.fabric, T(x, 0.075, 0.03, 0, Math.PI / 2, 0, 1, 1, 0.45), dark);
  aoLocal(B, M, gh, 0, 0, 0.32, 0.26, 0, 0.9);
}

function boots(B, M, R, gh) {
  // pair of leather hiking boots, one tipped over, laces loose
  const shoe = (m, tip) => B.with(m, () => {
    const sole = sweepY(0, 0.035, () => ({ rx: 0.052, rz: 0.14, cz: 0.0, n: 2.4 }), 1, 24);
    B.add(sole, M.rubber, null, 0x1e1a18);
    for (let i = 0; i < 9; i++) B.add(box(0.1, 0.006, 0.008), M.rubber, T(0, 0.0, -0.12 + i * 0.03), 0x141210); // lugs
    B.add(sweepY(0.03, 0.1, (t) => ({ rx: 0.05 - 0.004 * t, rz: 0.135 - 0.02 * t, cz: 0.005 * t, n: 2.3 }), 3, 24), M.fabric, null, 0x5c3c24, { shade: grime(0.07, 0.5) });
    B.add(sweepY(0.1, 0.19, (t) => ({ rx: 0.046, rz: 0.055 - 0.004 * t, cz: -0.07, n: 2.2 }), 3, 20), M.fabric, null, 0x4e3220);
    B.add(torus(0.045, 0.009, 6, 20), M.fabric, T(0, 0.19, -0.07, Math.PI / 2, 0, 0, 1, 1.15, 1), 0x2a1c12); // padded collar
    B.add(box(0.07, 0.02, 0.09), M.fabric, T(0, 0.095, 0.04, -0.35, 0, 0), 0x4a2e1c); // toe cap
    // tongue + laces + hooks
    B.add(box(0.05, 0.1, 0.01), M.fabric, T(0, 0.15, -0.015, -0.25, 0, 0), 0x6a4a30);
    for (let i = 0; i < 5; i++) { const y = 0.1 + i * 0.022, z = -0.005 - i * 0.012; B.add(box(0.06, 0.003, 0.004), M.rope, T(0, y, z, 0.3, 0, (i % 2 ? 0.25 : -0.25)), 0xc23a2a); for (const sx of [-1, 1]) B.add(sphere(0.004, 6, 4), M.metal, T(sx * 0.03, y, z), 0x999999); }
    if (tip) B.add(tube([[0.03, 0.2, -0.03], [0.06, 0.17, 0.02], [0.08, 0.02, 0.06], [0.12, 0.004, 0.1]], 0.0025, 16, 4), M.rope, null, 0xc23a2a);
  });
  shoe(T(-0.08, gh(-0.08, 0) + 0.002, 0, 0, 0.15, 0), false);
  shoe(T(0.14, gh(0.14, 0.04) + 0.05, 0.04, 0, -0.35, -1.35), true);
  aoLocal(B, M, gh, 0.02, 0, 0.25, 0.22, 0, 0.8);
}

function fireKit(B, M, R, gh) {
  // (local frame = fire ring centre) water bucket, kindling bundle, birch bark, poker, matchbox, skillet on a stone
  // galvanised bucket with water
  B.with(T(1.55, gh(1.55, -1.1), -1.1), () => {
    B.add(vessel([[0.001, 0], [0.12, 0], [0.125, 0.01], [0.15, 0.25], [0.152, 0.26]], 0.0025, 32), M.metal, null, 0xa9aeb2, { shade: (p, n, c) => { grime(0.05, 0.6)(p, n, c); if (Math.abs(p.y - 0.09) < 0.006 || Math.abs(p.y - 0.18) < 0.006) c.multiplyScalar(0.75); } });
    B.add(new THREE.CircleGeometry(0.145, 28).rotateX(-Math.PI / 2).translate(0, 0.21, 0), M.enamel, null, 0x243038);
    B.add(tube(sagPoints(V3(-0.152, 0.23, 0), V3(0.152, 0.23, 0), -0.12, 16).map((p, i, a) => p.add(V3(0, 0, -0.07 * Math.sin(i / (a.length - 1) * Math.PI)))), 0.0028, 20, 5), M.metal, null, 0x9ea3a8);
    for (const sx of [-1, 1]) B.add(cyl(0.012, 0.012, 0.006, 10), M.metal, T(sx * 0.151, 0.23, 0, 0, 0, Math.PI / 2), 0x8a8f94);
    B.add(cyl(0.012, 0.012, 0.09, 10), M.wood, T(0, 0.35, -0.065, 0, 0, Math.PI / 2), 0x6a4a30);
  });
  aoLocal(B, M, gh, 1.55, -1.1, 0.22, 0.22, 0, 0.9);
  // kindling bundle tied with twine
  B.with(T(-1.35, gh(-1.35, -0.55) + 0.035, -0.55, 0, 0.6, 0), () => {
    for (let i = 0; i < 16; i++) { const a = R() * 6.28, d = Math.sqrt(R()) * 0.03; B.add(pie(0.009 + R() * 0.006, 0.42 + R() * 0.06, 1.2, R() * 6, 3, i), M.wood, T(Math.cos(a) * d, Math.sin(a) * d, (R() - 0.5) * 0.03, 0, 0, R() * 6), [0xd9bb8c, 0xcfae7c, 0xe3c79c][i % 3]); }
    for (const z of [-0.11, 0.11]) B.add(torus(0.042, 0.0025, 4, 16), M.rope, T(0, 0, z), 0xc8b490);
  });
  // birch bark curls (tinder)
  for (let i = 0; i < 4; i++) { const x = -1.1 + R() * 0.2, z = -0.85 + R() * 0.2; B.add(cyl(0.025, 0.025, 0.08, 10, 1, true, 0, 4.2), M.paint, T(x, gh(x, z) + 0.02, z, Math.PI / 2, R() * 6, 0), 0xf0ece0, { shade: (p, n, c) => { if (((p.y * 60) | 0) % 3 === 0) c.multiplyScalar(0.55); } }); }
  // fire poker resting on the ring
  B.add(loft([[1.35, gh(1.35, 0.55) + 0.02, 0.55], [0.95, 0.2, 0.35], [0.62, 0.3, 0.22]], () => [0.006, 0.006], 10, 6), M.iron, null, 0x2a2826);
  B.add(torus(0.03, 0.005, 6, 14), M.iron, T(1.38, gh(1.38, 0.57) + 0.03, 0.57, Math.PI / 2 - 0.2, 0, 0.45), 0x2a2826);
  B.add(cyl(0.006, 0.003, 0.05, 6), M.iron, T(0.6, 0.315, 0.21, 0, 0, 1.1), 0x1c1a18);
  // matchbox by the kindling (label via face colours)
  B.with(T(-1.05, gh(-1.05, -0.35) + 0.009, -0.35, 0, 0.4, 0), () => {
    B.add(rbox(0.053, 0.016, 0.036, 0.0015), M.paint, null, 0xd8c8a0, { face: (c, n) => (Math.abs(n.x) > 0.9 ? { mat: M.paint, color: 0x5a3020 } : n.y > 0.9 ? { mat: M.paint, color: 0xb83222 } : null) });
    B.add(box(0.02, 0.002, 0.002), M.wood, T(0.036, -0.006, 0.01, 0, 0.3, 0), 0xe0c090);
    B.add(sphere(0.0022, 6, 4), M.paint, T(0.047, -0.006, 0.013), 0x222222);
  });
  // flat stone at the ring edge with a cast iron skillet and a wooden spatula
  B.with(T(-0.2, gh(-0.2, 1.05), 1.05, 0, 0.5, 0), () => {
    const st = jitter(new THREE.IcosahedronGeometry(0.22, 3), 0.05, 5, 11); st.scale(1, 0.25, 0.85); smoothNormals(st);
    B.add(st, M.iron, T(0, 0.02, 0), 0x4a4744, { shade: (p, n, c) => { c.multiplyScalar(0.8 + 0.25 * n.y); } });
    const sk = vessel([[0.001, 0], [0.12, 0], [0.13, 0.008], [0.135, 0.04], [0.14, 0.045]], 0.005, 32);
    B.add(sk, M.iron, T(0, 0.075, 0), 0x1e1d1c, { local: true, shade: (p, n, c) => { if (n.y > 0.8 && p.y < 0.02) c.multiplyScalar(1.3); } });
    B.add(rbox(0.16, 0.012, 0.03, 0.005), M.iron, T(0.21, 0.105, 0, 0, 0, 0.12), 0x1e1d1c);
    B.add(torus(0.008, 0.0035, 5, 10), M.iron, T(0.285, 0.114, 0, Math.PI / 2, 0, 0.12), 0x1e1d1c);
    B.add(box(0.035, 0.01, 0.022), M.iron, T(-0.137, 0.11, 0), 0x1e1d1c); // helper handle
    B.add(rbox(0.22, 0.006, 0.05, 0.002), M.wood, T(0.03, 0.09, -0.02, 0, 0.6, 0.12), 0xc8a070);
  });
  aoLocal(B, M, gh, -0.2, 1.05, 0.3, 0.25, 0, 0.7);
  // roasting sticks leaning against the log seat, peeled tips blackened
  for (let i = 0; i < 3; i++) {
    const x = 1.95 + i * 0.07, z = -0.45 - i * 0.05;
    B.add(loft([[x, gh(x, z), z], [x + 0.08, 0.38, z + 0.25], [x + 0.14, 0.72, z + 0.5]], (t) => [0.008 - 0.004 * t, 0.008 - 0.004 * t], 10, 6), M.wood, null, 0x8a6a48, { shade: (p, n, c) => { if (p.y > 0.6) c.multiplyScalar(0.25); } });
  }
}

function tableTop(B, M, R) {
  // (local frame = table, top surface at y=0.715) stove + gas can, cutting board & knife, plate, coffee dripper, book
  const y = 0.715;
  // single-burner stove screwed on a gas canister
  B.with(T(0.33, y, -0.1), () => {
    B.add(lathe([[0.001, 0], [0.05, 0], [0.055, 0.01], [0.055, 0.075], [0.05, 0.09], [0.02, 0.1], [0.015, 0.105], [0.001, 0.105]], 28), M.paint, null, 0x2b5ca8, { shade: (p, n, c) => { if (p.y > 0.03 && p.y < 0.06) c.setRGB(0.92, 0.9, 0.85); } });
    B.add(cyl(0.017, 0.02, 0.03, 16), M.metal, T(0, 0.12, 0), 0xc8a060);
    B.add(cyl(0.032, 0.03, 0.012, 20), M.metal, T(0, 0.14, 0), 0x707478);
    for (let i = 0; i < 20; i++) { const a = i / 20 * 6.28; B.add(box(0.002, 0.004, 0.006), M.metal, T(Math.cos(a) * 0.032, 0.146, Math.sin(a) * 0.032, 0, -a, 0), 0x222222); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * 6.28 + 0.4; B.add(loft([[Math.cos(a) * 0.03, 0.14, Math.sin(a) * 0.03], [Math.cos(a) * 0.07, 0.15, Math.sin(a) * 0.07], [Math.cos(a) * 0.075, 0.16, Math.sin(a) * 0.075]], () => [0.0035, 0.006], 6, 4), M.metal, null, 0xb8bcc0); }
    B.add(tube([[0.02, 0.125, 0], [0.05, 0.12, 0.02], [0.06, 0.1, 0.05]], 0.003, 10, 5), M.metal, null, 0xb8bcc0); // valve wire
    B.add(cyl(0.008, 0.008, 0.01, 10), M.plastic, T(0.06, 0.1, 0.055, Math.PI / 2, 0, 0), 0xd0302a);
  });
  // cutting board, knife, half onion
  B.with(T(-0.24, y, -0.14, 0, 0.12, 0), () => {
    B.add(rbox(0.3, 0.016, 0.19, 0.006), M.wood, T(0, 0.008, 0), 0xd8b890, { shade: (p, n, c) => { if (n.y > 0.9) c.multiplyScalar(0.95); } });
    for (let i = 0; i < 9; i++) B.add(box(0.05 + R() * 0.06, 0.0006, 0.0008), M.wood, T((R() - 0.5) * 0.2, 0.0165, (R() - 0.5) * 0.14, 0, R() * 3, 0), 0x8a6a48);
    B.add(box(0.12, 0.002, 0.024), M.metal, T(0.06, 0.018, 0.05, 0, 0.3, 0), 0xd8dce0);
    B.add(rbox(0.1, 0.016, 0.022, 0.007), M.wood, T(-0.05, 0.024, 0.08, 0, 0.3, 0), 0x3a2418);
    const on = sphere(0.035, 16, 10, 0).scale(1, 0.85, 1); on.translate(0, 0, 0);
    B.add(new THREE.SphereGeometry(0.034, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), M.enamel, T(-0.08, 0.05, -0.04), 0xd8c89a, { shade: (p, n, c) => { const r = Math.hypot(p.x + 0.08, p.z + 0.04); if (n.y > 0.9 && ((r * 300) | 0) % 2) c.multiplyScalar(0.9); } });
    B.add(new THREE.CircleGeometry(0.034, 18).rotateX(-Math.PI / 2), M.enamel, T(-0.08, 0.0505, -0.04), 0xf4f0e0, { shade: (p, n, c) => { const r = Math.hypot(p.x + 0.08, p.z + 0.04); if (((r * 320) | 0) % 2) c.multiplyScalar(0.88); } });
  });
  // enamel plate with fork
  B.with(T(0.2, y, 0.17), () => {
    B.add(lathe([[0.001, 0.0], [0.07, 0.0], [0.085, 0.012], [0.11, 0.018], [0.112, 0.02], [0.108, 0.022], [0.083, 0.015], [0.066, 0.004], [0.001, 0.004]], 32), M.enamel, null, 0xf0ece2, { shade: (p, n, c) => { if (Math.hypot(p.x, p.z) > 0.106) c.setRGB(0.08, 0.16, 0.34); } });
    B.add(box(0.14, 0.0025, 0.012), M.metal, T(0.02, 0.012, 0.02, 0, 0.5, 0.05), 0xc8ccd0);
  });
  // pour-over dripper on a steel mug
  B.with(T(-0.02, y, -0.2), () => {
    B.add(vessel([[0.001, 0], [0.038, 0], [0.04, 0.085], [0.041, 0.09]], 0.0018, 24), M.metal, null, 0xc0c4c8);
    B.add(torus(0.024, 0.004, 6, 14, Math.PI), M.metal, T(0.04, 0.045, 0, 0, 0, -Math.PI / 2), 0xc0c4c8);
    B.add(lathe([[0.02, 0.09], [0.028, 0.092], [0.06, 0.155], [0.058, 0.157], [0.026, 0.096], [0.02, 0.096]], 24), M.plastic, null, 0xe8d8b0);
    B.add(cyl(0.055, 0.047, 0.0015, 24), M.plastic, T(0, 0.14, 0), 0x3a2414); // coffee grounds
  });
  // paperback + pencil
  B.with(T(-0.44, y, 0.16, 0, -0.2, 0), () => {
    B.add(rbox(0.13, 0.022, 0.19, 0.002), M.paint, T(0, 0.011, 0), 0xf2ead8, { face: (c, n) => (n.y > 0.9 || n.y < -0.9 ? { mat: M.paint, color: 0x2c5a4a } : Math.abs(n.x) > 0.9 && c.x < 0 ? { mat: M.paint, color: 0x2c5a4a } : null) });
    B.add(box(0.1, 0.0005, 0.03), M.paint, T(0.005, 0.0225, 0.05), 0xe8d8a0);
    B.add(cyl(0.0035, 0.0035, 0.17, 6).rotateZ(Math.PI / 2), M.paint, T(0.02, 0.026, -0.12, 0, 0.3, 0), 0xe0b020);
  });
}

function tentInterior(B, M, R) {
  // (local frame = tent, floor at y=0) sleeping pad, mummy bag, pillow, headlamp, water bottle
  const pad = rbox(1.9, 0.045, 0.56, 0.02, 3);
  B.add(pad, M.plastic, T(0.05, 0.025, -0.22), 0x3d5a78, { shade: (p, n, c) => { if (((p.x + 2) * 12 | 0) % 2 && n.y > 0.5) c.multiplyScalar(0.9); } });
  // mummy bag along +x (head at -x), partly unzipped with the top corner folded back
  const bag = sweepY(-0.85, 0.85, (t) => { const s = 1 - 0.35 * smooth(0.45, 1, t) - 0.15 * (1 - smooth(0, 0.08, t)); return { rx: 0.29 * s, rz: 0.1 * s - 0.03 * smooth(0.8, 1, t) + 0.02 * smooth(0, 0.15, t) * (1 - smooth(0.15, 0.3, t)), n: 2.4 }; }, 24, 24);
  bag.rotateZ(-Math.PI / 2); // sweep axis y -> x ; cross-section x -> -y
  const p = bag.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setY(i, Math.max(y, -0.07) * (y < 0 ? 0.35 : 1)); p.setX(i, -p.getX(i)); } bag.computeVertexNormals();
  B.add(bag, M.fabric, T(0.05, 0.13, -0.22, Math.PI / 2 - Math.PI / 2, 0, 0), 0x8a3a2a, { shade: (q, n, c) => { const k = ((q.x + 3) * 7.5) % 1; c.multiplyScalar(0.84 + 0.16 * Math.sin(k * Math.PI)); } });
  B.add(ribbon([[-0.75, 0.21, -0.03], [-0.2, 0.2, 0.0], [0.4, 0.17, 0.02]], 0.008, 0.004, 16), M.rubber, null, 0x111111);
  B.add(ribbon([[-0.7, 0.22, -0.12], [-0.55, 0.26, 0.02], [-0.4, 0.22, 0.12]], 0.3, 0.015, 10, V3(1, 0, 0)), M.fabric, null, 0xd8a040); // folded-back lining
  // pillow + headlamp + bottle
  B.add(rbox(0.34, 0.09, 0.26, 0.045, 3), M.fabric, T(-0.83, 0.1, -0.22, 0, 0.1, 0.06), 0x6c7e8c);
  B.with(T(-0.55, 0.035, 0.22, 0, 0.8, 0), () => {
    B.add(torus(0.055, 0.008, 4, 20), M.fabric, T(0, 0.004, 0, Math.PI / 2, 0, 0, 1, 1.2, 1), 0x222222);
    B.add(rbox(0.045, 0.03, 0.028, 0.006), M.plastic, T(0.06, 0.016, 0), 0xd8d020);
    B.add(cyl(0.011, 0.011, 0.004, 14), M.glass, T(0.075, 0.016, 0, 0, 0, Math.PI / 2), 0xffffff);
  });
  B.add(cyl(0.035, 0.035, 0.2, 18).rotateZ(Math.PI / 2), M.plastic, T(0.62, 0.04, 0.3, 0, 0.5, 0), 0x2d8a6a);
}

function clothesline(B, M, R, A, Bp, U, sway) {
  // rope with sag, towel folded over, bandana, socks, wooden pegs; cloth sways (aSway weight)
  const pts = sagPoints(A, Bp, 0.16, 24), curve = new THREE.CatmullRomCurve3(pts);
  B.add(tube(pts, 0.0035, 48, 5), M.rope, null, 0xd8cdb0);
  const dir = Bp.clone().sub(A).setY(0).normalize(), side = V3(-dir.z, 0, dir.x), ry = Math.atan2(-dir.z, dir.x);
  const hang = (t, w, hgt, color, folded, pegs = 2) => {
    const P = curve.getPointAt(t);
    const mk = (off, flip) => {
      const g = new THREE.PlaneGeometry(w, hgt, 8, 12); g.translate(0, -hgt / 2, 0);
      const q = g.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), y = q.getY(i); q.setZ(i, off + Math.sin(x * 14 + y * 3) * 0.008 + y * y * 0.02 * (flip ? -1 : 1)); }
      g.computeVertexNormals();
      B.add(g, sway, T(P.x, P.y - 0.003, P.z, 0, ry, 0), color, { sway: (v) => Math.min(1, (P.y - v.y) / 0.9), shade: (v, n, c) => { const d = P.y - v.y; if (d > hgt - 0.05) c.multiplyScalar(0.8); if (Math.abs(d - 0.06) < 0.012 || Math.abs(d - (hgt - 0.08)) < 0.012) c.multiplyScalar(0.85); } });
    };
    mk(0.006, false); if (folded) mk(-0.006, true);
    for (let k = 0; k < pegs; k++) {
      const pp = curve.getPointAt(t + (k - (pegs - 1) / 2) * (w * 0.8) / curve.getLength());
      B.add(rbox(0.012, 0.07, 0.011, 0.003), M.wood, T(pp.x, pp.y - 0.015, pp.z, 0, ry, 0), 0xd8b890);
      B.add(box(0.013, 0.005, 0.012), M.metal, T(pp.x, pp.y - 0.02, pp.z, 0, ry, 0), 0xa0a4a8);
    }
  };
  hang(0.3, 0.5, 0.42, 0x2f7a8a, true, 2);  // bath towel folded over the line
  hang(0.47, 0.34, 0.3, 0xd84a3a, false, 2); // bandana
  hang(0.6, 0.1, 0.24, 0x8a8a80, false, 1); hang(0.64, 0.1, 0.23, 0x8a8a80, false, 1); // socks
  hang(0.76, 0.42, 0.52, 0xe8e0c8, false, 2); // t-shirt
  // knots
  for (const E of [A, Bp]) B.add(torus(0.012, 0.004, 5, 10), M.rope, T(E.x, E.y, E.z, Math.PI / 2, 0, 0), 0xd8cdb0);
}

function signpost(B, M, R, gh, signMat, arrowMat) {
  // two posts with a routed wooden board; board faces +z
  for (const x of [-0.55, 0.55]) {
    B.add(cyl(0.05, 0.055, 1.35, 10), M.bark, T(x, gh(x, 0) + 0.6, 0), 0x8a7a6a, { shade: grime(0.15, 0.5) });
    B.add(cyl(0.05, 0.05, 0.004, 10), M.endgrain, T(x, gh(x, 0) + 1.277, 0), 0xb09070);
  }
  B.add(rbox(1.3, 0.34, 0.045, 0.01), signMat, T(0, gh(0, 0) + 1.02, 0.06), 0xffffff);
  for (const x of [-0.55, 0.55]) for (const y of [0.94, 1.1]) B.add(cyl(0.008, 0.008, 0.006, 8), M.metal, T(x, gh(0, 0) + y, 0.084, Math.PI / 2, 0, 0), 0x55504a);
  // small arrow board pointing to the lake
  B.add(rbox(0.62, 0.13, 0.03, 0.006), arrowMat, T(-0.22, gh(0, 0) + 0.66, 0.05, 0, 0, -0.04), 0xffffff);
  aoLocal(B, M, gh, -0.55, 0, 0.14, 0.14, 0, 0.7); aoLocal(B, M, gh, 0.55, 0, 0.14, 0.14, 0, 0.7);
}

function signTexture(lines, w = 1024, h = 512, arrow = 0) {
  // routed letters: dark cut with a lit lower edge, on weathered planks. lines = [[text, sizePx, yFrac], ...]
  return canvasTex(w, h, (g) => {
    const R = rng(w + h);
    g.fillStyle = '#9a7650'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { const y = R() * h; g.strokeStyle = `rgba(${R() > 0.5 ? '60,38,20' : '200,170,120'},${0.08 + R() * 0.12})`; g.lineWidth = 1 + R() * 3; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 40) g.lineTo(x, y + Math.sin(x * 0.01 + i) * 4); g.stroke(); }
    if (h > 300) { g.fillStyle = 'rgba(40,25,12,0.5)'; g.fillRect(0, h * 0.5 - 2, w, 4); }
    for (const [s, size, yf] of lines) {
      g.font = `bold ${size}px Georgia, 'Noto Serif CJK JP', 'Times New Roman', serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      let sz = size; while (g.measureText(s).width > w * 0.86 && sz > 20) { sz -= 4; g.font = `bold ${sz}px Georgia, 'Noto Serif CJK JP', serif`; } // never clip at the board edge
      g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillText(s, w / 2 + 2, h * yf + 3); g.fillStyle = '#2a1a0c'; g.fillText(s, w / 2, h * yf);
    }
    if (arrow) { const x = arrow > 0 ? w * 0.9 : w * 0.1, d = arrow * h * 0.28; g.fillStyle = '#2a1a0c'; g.beginPath(); g.moveTo(x + d, h / 2); g.lineTo(x - d * 0.2, h * 0.2); g.lineTo(x - d * 0.2, h * 0.8); g.closePath(); g.fill(); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(30,40,20,0.3)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, true, false);
}

function dockKit(B, M, R) {
  // (local frame = dock, deck top y=0.03, deck runs toward -z, width 2)
  const y = 0.03;
  // tackle box
  B.with(T(0.58, y, -1.6, 0, 0.3, 0), () => {
    B.add(rbox(0.36, 0.16, 0.2, 0.015, 2), M.plastic, T(0, 0.08, 0), 0x3f6a3a, { shade: grime(0.03, 0.4) });
    B.add(rbox(0.365, 0.03, 0.205, 0.012, 2), M.plastic, T(0, 0.17, 0), 0x345a30);
    B.add(tube([[-0.1, 0.185, 0], [-0.08, 0.23, 0], [0.08, 0.23, 0], [0.1, 0.185, 0]], 0.009, 12, 6), M.plastic, null, 0x222222);
    for (const x of [-0.12, 0.12]) B.add(rbox(0.03, 0.04, 0.01, 0.003), M.metal, T(x, 0.15, 0.104), 0xb0b4b8);
  });
  // galvanised bait bucket + landing net lying across the deck
  B.with(T(-0.6, y, -13.2), () => {
    B.add(vessel([[0.001, 0], [0.11, 0], [0.13, 0.24], [0.132, 0.245]], 0.002, 28), M.metal, null, 0xa9aeb2, { shade: grime(0.05, 0.5) });
    B.add(new THREE.CircleGeometry(0.125, 24).rotateX(-Math.PI / 2).translate(0, 0.17, 0), M.enamel, null, 0x2a3530);
    B.add(tube(sagPoints(V3(-0.132, 0.22, 0), V3(0.132, 0.22, 0), -0.1, 12), 0.0025, 16, 5), M.metal, null, 0x9ea3a8);
  });
  B.with(T(0.2, y + 0.018, -12.2, 0, 0.9, 0), () => {
    B.add(cyl(0.014, 0.014, 0.9, 10).rotateZ(Math.PI / 2), M.wood, T(-0.62, 0, 0), 0x9a7048);
    B.add(torus(0.2, 0.008, 6, 28), M.metal, T(0, 0, 0, Math.PI / 2, 0, 0, 1, 0.75, 1), 0x2a2a2a);
    B.add(new THREE.SphereGeometry(0.2, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.4).scale(1, 0.18, 0.75), M.rope, null, 0x5a6a4a);
  });
  // mooring cleats + a coiled rope at the end
  for (const x of [-0.86, 0.86]) {
    B.add(rbox(0.07, 0.03, 0.05, 0.008), M.iron, T(x, y + 0.015, -15.2), 0x2a2826);
    B.add(loft([[x, y + 0.045, -15.32], [x, y + 0.055, -15.2], [x, y + 0.045, -15.08]], (t) => [0.012 + 0.01 * Math.abs(t - 0.5), 0.012], 8, 8), M.iron, null, 0x2a2826);
  }
  const coil = []; for (let i = 0; i <= 120; i++) { const a = i / 120 * Math.PI * 2 * 4, r = 0.13 - i / 120 * 0.06; coil.push(V3(0.55 + Math.cos(a) * r, y + 0.012 + (i > 100 ? (i - 100) * 0.001 : 0), -14.7 + Math.sin(a) * r)); }
  B.add(tube(coil, 0.011, 240, 6), M.rope, null, 0xc8b890);
  B.add(tube([[0.55 + 0.07, y + 0.035, -14.7], [0.75, y + 0.03, -14.95], [0.86, y + 0.055, -15.2], [0.95, y + 0.02, -15.35]], 0.011, 16, 6), M.rope, null, 0xc8b890);
}

// Clear grass (and flora) density under prop footprints in the baked world-data texture (G channel). The grass
// shader reads that texture, so tent floors / cooler / table no longer have blades growing through them.
// fp: [{x, z, r}] world-space circles. The texture is ~1.4m per texel -> soft edge of one texel.
export function clearGrass(worldData, fp) {
  if (!worldData?.data) return;
  const { data, res, size } = worldData, cs = size / (res - 1);
  for (const c of fp) {
    const i0 = Math.floor((c.x - c.r - cs) / cs + (res - 1) / 2), i1 = Math.ceil((c.x + c.r + cs) / cs + (res - 1) / 2);
    const j0 = Math.floor((c.z - c.r - cs) / cs + (res - 1) / 2), j1 = Math.ceil((c.z + c.r + cs) / cs + (res - 1) / 2);
    for (let j = Math.max(0, j0); j <= Math.min(res - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(res - 1, i1); i++) {
      const x = (i / (res - 1) - 0.5) * size, z = (j / (res - 1) - 0.5) * size, d = Math.hypot(x - c.x, z - c.z);
      const k = 1 - smooth(c.r, c.r + cs, d); if (k <= 0) continue;
      data[(j * res + i) * 4 + 1] *= 1 - k;
    }
  }
  worldData.tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------------------------- main
export function buildCampDetails(ctx) {
  const { scene, textures, U, heightAt, colliders } = ctx;
  const C = ctx.camp || WORLD.camp;
  const M = kitMaterials(textures);
  kitTextures();
  const sway = swayMaterial(M.fabric, U); sway.side = THREE.DoubleSide;
  const signMat = new THREE.MeshStandardMaterial({ name: 'sign', map: signTexture([['MODAN CAMP', 150, 0.3], ['湖畔の森キャンプ場', 104, 0.74]]), roughness: 0.85 });
  const arrowMat = new THREE.MeshStandardMaterial({ name: 'signArrow', map: signTexture([['湖・桟橋  LAKE', 78, 0.52]], 1024, 200, 0), roughness: 0.85 });
  const B = new Batch();
  const R = rng(4242);
  const group = new THREE.Group(); group.name = 'campDetails';
  const footprints = [];
  const addCol = (x, z, r, tag) => { footprints.push({ x, z, r: r * 0.9 }); return colliders?.add?.(x, z, r, tag); };

  // place a builder at world x,z with yaw ry; gh() gives the local ground height
  const place = (x, z, ry, fn, lift = 0) => {
    const y0 = heightAt(x, z) + lift, c = Math.cos(ry), s = Math.sin(ry);
    const gh = (lx, lz) => heightAt(x + lx * c + lz * s, z - lx * s + lz * c) - y0;
    B.with(T(x, y0, z, 0, ry, 0), () => fn(gh));
  };

  const fx = ctx.firePos?.x ?? C.x, fz = ctx.firePos?.z ?? C.z;
  const tO = ctx.tentOrigin || { x: C.x - 6.5, z: C.z + 3.5 }, tR = ctx.tentRot ?? 0.9;

  // chopping block next to the woodpile (+ collider)
  place(C.x - 4.7, C.z - 3.3, 0.4, (gh) => choppingBlock(B, M, R, gh)); addCol(C.x - 4.7, C.z - 3.3, 0.3, 'block');
  // cooler + water jug + stool around the table
  place(C.x + 5.25, C.z + 3.1, -0.5 + 0.15, (gh) => cooler(B, M, R, gh)); addCol(C.x + 5.25, C.z + 3.1, 0.36, 'cooler');
  place(C.x + 3.35, C.z + 5.05, -0.9, (gh) => waterJug(B, M, R, gh)); addCol(C.x + 3.35, C.z + 5.05, 0.18, 'jug');
  place(C.x + 3.2, C.z + 3.35, 0.3, (gh) => stool(B, M, R, gh)); addCol(C.x + 3.2, C.z + 3.35, 0.22, 'stool');
  // fire kit around the ring
  place(fx, fz, 0, (gh) => fireKit(B, M, R, gh));
  addCol(fx + 1.55, fz - 1.1, 0.18, 'bucket');
  // table top items (the table itself is main.js / props.buildTable)
  B.with(T(C.x + 4.2, heightAt(C.x + 4.2, C.z + 4.2), C.z + 4.2, 0, -0.5, 0), () => tableTop(B, M, R));
  // tent: interior + backpack + boots at the open door
  {
    const c = Math.cos(tR), s = Math.sin(tR), y0 = heightAt(tO.x, tO.z) + 0.02;
    const toW = (lx, lz) => [tO.x + lx * c + lz * s, tO.z - lx * s + lz * c];
    B.with(T(tO.x, y0, tO.z, 0, tR, 0), () => tentInterior(B, M, R));
    // backpack leaning on the fly, right of the door (tent local angle ~ +20deg from +x toward +z)
    const pa = 0.55, [bx, bz] = toW(Math.cos(pa) * 1.47, Math.sin(pa) * 1.47);
    const out = Math.atan2(Math.cos(pa) * c + Math.sin(pa) * s, -Math.cos(pa) * s + Math.sin(pa) * c);
    B.with(T(bx, heightAt(bx, bz) - 0.01, bz, 0, out, 0).multiply(T(0, 0, 0, -0.2, 0, 0)), () => backpack(B, M, R, () => 0.01));
    // (no own collider: the pack leans on the fly, inside the tent's 1.55m collider)
    const [ox, oz] = toW(0.62, 1.55);
    place(ox, oz, tR + 0.3, (gh) => boots(B, M, R, gh));
  }
  // clothesline: from the string-light pole (A) to a new pole
  {
    const pA = ctx.poleA || [C.x - 5.6, C.z + 1.6];
    const pB = [C.x - 9.6, C.z - 0.8];
    const hB = heightAt(pB[0], pB[1]);
    B.add(cyl(0.035, 0.045, 2.1, 10), M.bark, T(pB[0], hB + 1.0, pB[1], 0.03, 0, -0.04), 0x8a7a6a, { shade: grime(0.15, 0.5) });
    B.add(cyl(0.035, 0.035, 0.004, 10), M.endgrain, T(pB[0] - 0.04, hB + 2.05, pB[1] + 0.03), 0xb09070);
    addCol(pB[0], pB[1], 0.12, 'pole');
    clothesline(B, M, R, V3(pA[0] - 0.035, heightAt(pA[0], pA[1]) + 1.85, pA[1] - 0.02), V3(pB[0] - 0.04, hB + 1.9, pB[1] + 0.02), U, sway);
    // laundry hangs 1.26-1.45m above ground = below eye height (1.65): walking through it put the camera inside the
    // towels. Block the hung section (t 0.25..0.8) with a chain of small colliders.
    for (let t = 0.27; t <= 0.8; t += 0.09) addCol(pA[0] + (pB[0] - pA[0]) * t, pA[1] + (pB[1] - pA[1]) * t, 0.22, 'laundry');
  }
  // camp sign where the path leaves toward the lake
  {
    const [p0x, p0z] = PATH_PTS[0], [p1x, p1z] = PATH_PTS[1];
    const dx = p1x - p0x, dz = p1z - p0z, L = Math.hypot(dx, dz), sx = p0x - dz / L * 2.1 + dx / L * 1.2, sz = p0z + dx / L * 2.1 + dz / L * 1.2;
    // board faces the camp (toward the fire) so it is read when walking out
    place(sx, sz, Math.atan2(fx - sx, fz - sz), (gh) => signpost(B, M, R, gh, signMat, arrowMat));
    addCol(sx, sz, 0.35, 'sign');
  }
  // tent: drop stakes / guy lines / fly hem onto the terrain (they floated up to 9cm on the downhill side)
  if (ctx.tent && !ctx.tent.userData.settled) settleToGround(ctx.tent, heightAt);

  // two clusters: camp (~20m) and dock (~40m away). One world-spanning merged mesh per material defeated frustum
  // and shadow-camera culling (the dock items were drawn into the shadow map while standing at the fire).
  // grass-free footprints: tent (floor + vestibule), table, chair, log seats, woodpile and our own props
  footprints.push({ x: tO.x, z: tO.z, r: 1.35 }, { x: tO.x + Math.sin(tR) * 1.5, z: tO.z + Math.cos(tR) * 1.5, r: 0.8 });
  for (const f of ctx.extraFootprints || []) footprints.push(f);
  clearGrass(ctx.worldData, footprints);
  const meshes = B.build(group, 'camp');
  // dock kit (same placement maths as main.js buildCamp)
  if (ctx.dock) {
    ctx.dock.updateMatrixWorld();
    B.with(ctx.dock.matrixWorld.clone(), () => dockKit(B, M, R));
  } else {
    const [px0, pz0] = PATH_PTS[PATH_PTS.length - 1];
    const ddx = -Math.sin(0.12), ddz = -Math.cos(0.12);
    let ds = 0; while (ds < 12 && heightAt(px0 + ddx * ds, pz0 + ddz * ds) > 0.62) ds += 0.1;
    B.with(T(px0 + ddx * ds, 0.55, pz0 + ddz * ds, 0, 0.12, 0), () => dockKit(B, M, R));
  }
  meshes.push(...B.build(group, 'dock'));
  scene.add(group);
  group.userData.tris = meshes.reduce((a, m) => a + m.geometry.attributes.position.count / 3, 0);
  return {
    group, meshes,
    update() { /* cloth sway is driven by U.uTime/U.uWind in the shader */ },
  };
}
