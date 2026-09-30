// Node test for Sky.update() logic (no GPU; PMREM/renderer stubbed): moon phase continuity across midnight / sleep,
// moonlight vs phase, light intensity never NaN/negative, no light jump at the sun<->moon switch.
globalThis.window = { devicePixelRatio: 1 };
const THREE = await import('three');
const { Sky } = await import('../../src/world/sky.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const fakeRenderer = { compile() {} };
THREE.PMREMGenerator.prototype.fromScene = function () { return { texture: null, dispose() {} }; };
const origPM = THREE.PMREMGenerator; // constructor touches renderer only lazily in r170
const scene = new THREE.Scene();
const sky = new Sky(fakeRenderer, scene);
sky.envTimer = -1e9; // never refresh env
let h = 15.5, prevPhase = null, maxJump = 0, bad = 0, prevI = null, maxIJ = 0;
for (let i = 0; i < 24 * 60 * 3; i++) { // 3 game days, 1 game minute per step
  h += 1 / 60; if (h >= 24) h -= 24;
  sky.update(h, 1 / 60, new THREE.Vector3());
  const ph = sky.info.moonPhase;
  if (prevPhase !== null) { let d = Math.abs(ph - prevPhase); d = Math.min(d, 1 - d); maxJump = Math.max(maxJump, d); }
  prevPhase = ph;
  const I = sky.sun.intensity; if (!Number.isFinite(I) || I < 0) bad++;
  if (prevI !== null) maxIJ = Math.max(maxIJ, Math.abs(I - prevI)); prevI = I;
}
ok(maxJump < 0.01, 'moon phase continuous across midnight (max step ' + maxJump.toFixed(4) + ')');
ok(bad === 0, 'light intensity finite / >= 0');
ok(maxIJ < 0.2, 'no light pop per game-minute (max ' + maxIJ.toFixed(3) + ')');
ok(sky.dayCount === 3, 'dayCount after 3 wraps = ' + sky.dayCount);
// sleep: hours jump 22 -> 6.2 with state.day++ ; laned.js calls setDay(state.day) every frame
sky.setDay(5); sky.update(22, 0.016); const a = sky.info.moonPhase;
sky.setDay(6); sky.update(6.2, 0.016); const b = sky.info.moonPhase;
let d = b - a; if (d < 0) d += 1; ok(Math.abs(d - (8.2 / 24) / 8) < 0.002, 'sleep advances phase by 8.2h (' + d.toFixed(4) + ')');
// normal midnight with pinned day: main.js wraps hours AND does state.day++ in the same frame
sky.setDay(7); sky.update(23.99, 0.016); const m0 = sky.info.moonPhase; sky.setDay(8); sky.update(0.01, 0.016);
let dm = sky.info.moonPhase - m0; if (dm < 0) dm += 1; ok(dm < 0.001, 'pinned midnight: no extra day (' + dm.toFixed(4) + ')');
// moonlight brightness follows phase at the same moon position
const I = (day) => { sky.setDay(day); sky.update(23, 0.016); return sky.sun.intensity; };
const full = I(1), newm = I(5); // day1 23h phase ~0.61 (gibbous), day5 ~0.11 (new-ish)
ok(full > newm * 2.5, `moonlight full ${full.toFixed(3)} > new ${newm.toFixed(3)}`);
// hours passed as NaN must not poison state
sky.update(NaN, 0.016); ok(Number.isFinite(sky.info.moonPhase), 'NaN hours tolerated (phase ' + sky.info.moonPhase + ')');
sky.update(12, 0.016); ok(Number.isFinite(sky.info.moonPhase) && Number.isFinite(sky.sun.intensity), 'recovers after NaN hours');
process.exitCode = fail ? 1 : 0;
