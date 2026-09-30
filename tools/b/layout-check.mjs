// Lane B layout audit: builds the camp colliders exactly like main.js + campdetail.js (no rendering) and reports
// overlaps between props, props on the footpath, blocked walkways and the player spawn.
import * as THREE from 'three';
globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : k === 'measureText' ? () => ({ width: 100 }) : () => {}), set: () => true }), width: 0, height: 0 }) };
const { WORLD, heightAt } = await import('../../src/world/heightfield.js');
const { pathMask } = await import('../../src/world/terrain.js');
const { buildCampDetails } = await import('../../src/world/campdetail.js');
const C = WORLD.camp, cols = [];
const add = (x, z, r, tag) => cols.push({ x, z, r, tag });
const fx = C.x, fz = C.z, tx0 = C.x - 6.5, tz0 = C.z + 3.5;
add(fx, fz, 0.85, 'fire'); add(tx0, tz0, 1.55, 'tent');
for (const [x, z, r] of [[fx + 2.4, fz + 0.6, 1.4], [fx - 0.6, fz - 2.5, 0.2]]) for (const o of [-0.8, 0, 0.8]) add(x + Math.cos(r) * o, z - Math.sin(r) * o, 0.3, 'seat');
add(fx + 0.4, fz + 2.6, 0.35, 'chair'); add(C.x - 3.5, C.z - 2.2, 0.45, 'woodpile'); add(C.x + 4.2, C.z + 4.2, 0.6, 'table');
for (const [px, pz] of [[tx0 + 0.9, tz0 - 1.9], [C.x + 4.9, C.z + 5.6]]) add(px, pz, 0.12, 'pole');
const n0 = cols.length;
const f = { diff: null, nor: null, arm: null };
buildCampDetails({ scene: new THREE.Scene(), textures: { bark_brown_02: f, brown_planks_05: f, rocky_terrain_02: f }, U: { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() } }, heightAt, colliders: { add }, camp: C, firePos: new THREE.Vector3(fx, 0, fz), tentOrigin: { x: tx0, z: tz0 }, tentRot: 0.9, poleA: [tx0 + 0.9, tz0 - 1.9] });
let bad = 0;
const PR = 0.35; // player radius
for (let i = n0; i < cols.length; i++) {
  const a = cols[i];
  for (let j = 0; j < cols.length; j++) { if (i === j || cols[j].tag === a.tag) continue; const b = cols[j]; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d < a.r + b.r - 0.02) { console.log(`OVERLAP ${a.tag} <-> ${b.tag} d=${d.toFixed(2)} r=${(a.r + b.r).toFixed(2)}`); bad++; } else if (j < n0 || j > i) { const gap = d - a.r - b.r; if (gap > 0 && gap < PR * 2) console.log(`narrow gap ${a.tag}-${b.tag} ${gap.toFixed(2)}m (player needs ${(PR * 2).toFixed(2)})`); } }
  const pm = pathMask(a.x, a.z); if (pm > 0.05) { console.log(`ON PATH ${a.tag} mask=${pm.toFixed(2)}`); bad++; }
}
// player spawn (Player constructor + teleport on new game)
const src = (await import('fs')).readFileSync('src/game/player.js', 'utf8');
const m = src.match(/this\.pos\s*=\s*new THREE\.Vector3\(([^)]*)\)/); console.log('player spawn expr:', m?.[1]);
console.log(`${cols.length - n0} lane-B colliders checked, ${bad} problems`);
