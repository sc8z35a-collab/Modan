// World layout + analytic height function (shared by terrain mesh, placement, physics, shaders).
import { createNoise2D, fbm, ridged, smoothstep, lerp, clamp } from '../core/noise.js';

export const WORLD = {
  size: 720,            // playable terrain square (m)
  segments: 448,        // terrain grid resolution
  waterLevel: 0,
  lake: { x: -10, z: -70, r: 78 },
  camp: { x: 6, z: 18, y: 1.6, r: 16 },
  bound: 250,           // soft player boundary radius
  seed: 20260926,
};

const n1 = createNoise2D(WORLD.seed);
const n2 = createNoise2D(WORLD.seed + 17);
const n3 = createNoise2D(WORLD.seed + 91);

export function lakeDist(x, z) {
  const L = WORLD.lake;
  const dx = x - L.x, dz = (z - L.z) * 1.25;
  const a = Math.atan2(dz, dx);
  const rr = L.r * (1 + 0.18 * Math.sin(a * 2 + 0.7) + 0.1 * Math.sin(a * 5 + 2.1) + 0.12 * n2(Math.cos(a) * 1.3, Math.sin(a) * 1.3));
  return Math.hypot(dx, dz) - rr; // <0 inside lake
}

export function heightAt(x, z) {
  // base rolling hills
  let h = fbm(n1, x * 0.0035, z * 0.0035, 5) * 14 + 6;
  h += ridged(n3, x * 0.006 + 11, z * 0.006 - 7, 4) * 9 - 3;
  h += fbm(n2, x * 0.03, z * 0.03, 3) * 1.2; // small bumps

  // distant mountain ring
  const r = Math.hypot(x, z + 20);
  const m = smoothstep(190, 340, r);
  h += m * (40 + ridged(n1, x * 0.004, z * 0.004, 5) * 70);

  // lake basin
  const ld = lakeDist(x, z);
  const shore = smoothstep(38, -2, ld);         // blend region around the lake
  const beach = 0.35 + clamp(ld, 0, 38) * 0.09;
  // lakebed: starts at the beach height at the waterline (ld=0) and shelves down, so there is no
  // 1.5m vertical cliff at the shoreline (previously depth jumped from +0.35 to -1.2 at ld=0)
  const bed = -1.2 - smoothstep(0, -40, ld) * 7.5 + fbm(n2, x * 0.02, z * 0.02, 2) * 0.6;
  const depth = lerp(0.35, bed, smoothstep(0, -3, ld));
  h = lerp(h, ld < 0 ? depth : Math.min(h, beach + (h - beach) * smoothstep(4, 38, ld)), shore);

  // campsite plateau
  const C = WORLD.camp;
  const cd = Math.hypot(x - C.x, z - C.z);
  const cf = smoothstep(C.r + 14, C.r - 4, cd);
  h = lerp(h, C.y + fbm(n3, x * 0.08, z * 0.08, 2) * 0.12, cf);

  return h;
}

export function normalAt(x, z, e = 0.6) {
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

export function slopeAt(x, z) { return 1 - normalAt(x, z)[1]; }
