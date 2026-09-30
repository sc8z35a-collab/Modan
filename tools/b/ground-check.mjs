// Lane B: numeric grounding audit for camp props (terrain height vs. prop local y=0 plane)
import { heightAt, WORLD } from '../../src/world/heightfield.js';
const C = WORLD.camp;
const rot = (x, z, ry) => [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
function audit(name, ox, oz, ry, yo, pts) {
  const base = heightAt(ox, oz) + yo; let worst = 0; const rows = [];
  for (const [lx, lz, ly = 0] of pts) { const [dx, dz] = rot(lx, lz, ry); const h = heightAt(ox + dx, oz + dz); const d = base + ly - h; rows.push(d.toFixed(3)); if (Math.abs(d) > Math.abs(worst)) worst = d; }
  console.log(name.padEnd(12), 'worst', worst.toFixed(3), 'm  [', rows.join(' '), ']');
}
const fx = C.x, fz = C.z, tx0 = C.x - 6.5, tz0 = C.z + 3.5;
const ring = []; for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ring.push([Math.cos(a) * 1.2, Math.sin(a) * 1.06]); }
audit('tent-floor', tx0, tz0, 0.9, 0.02, ring);
const st = []; for (const a of [1, 3, 5, 7]) st.push([Math.cos(a * Math.PI / 4) * 2.35, Math.sin(a * Math.PI / 4) * 2.35, 0.03]); st.push([0, -2.3, 0.03], [0, 2.75, 0.03], [0, 2.05, 0.03]);
audit('tent-stakes', tx0, tz0, 0.9, 0.02, st);
audit('firering', fx, fz, 0, 0, [[0.72, 0], [-0.72, 0], [0, 0.72], [0, -0.72]]);
audit('tripod', fx, fz, 0, 0, [0, 1, 2].map((i) => [Math.cos(i / 3 * 6.283) * 0.75, Math.sin(i / 3 * 6.283) * 0.75]));
for (const [x, z, r] of [[fx + 2.4, fz + 0.6, 1.4], [fx - 0.6, fz - 2.5, 0.2]]) audit('logseat', x, z, r, 0, [[-1.1, 0, 0.2 - 0.23], [1.1, 0, 0.2 - 0.23], [0, 0, -0.03]]);
audit('chair', fx + 0.4, fz + 2.6, Math.atan2(0.4, 2.6), 0, [[-0.25, -0.25], [0.25, 0.25], [0.25, -0.25], [-0.25, 0.25]]);
audit('woodpile', C.x - 3.5, C.z - 2.2, 0.6, 0, [[-0.4, 0, 0.005], [0.4, 0, 0.005], [0, 0.25, 0.005], [0, -0.25, 0.005]]);
audit('table', C.x + 4.2, C.z + 4.2, -0.5, 0, [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]);
audit('lantern1', C.x - 4.4, C.z + 5.8, 0, 0, [[0.09, 0], [-0.09, 0], [0, 0.09], [0, -0.09]]);
console.log('camp', C, 'h', heightAt(C.x, C.z).toFixed(2));
// verify settleToGround: sample the corrected stake heights (same maths as props.settleToGround rigid branch)
{
  const [ox, oz, ry] = [C.x - 6.5, C.z + 3.5, 0.9], base = heightAt(ox, oz);
  let worst = 0; for (const [lx, lz] of st) { const [dx, dz] = rot(lx, lz, ry); const h = heightAt(ox + dx, oz + dz); const y = base + 0.02 + 0.03 + (h - base) * (1 - 0.03 / 0.7); worst = Math.max(worst, Math.abs(y - 0.03 - h)); }
  console.log('tent-stakes after settle: worst', worst.toFixed(3), 'm');
}
