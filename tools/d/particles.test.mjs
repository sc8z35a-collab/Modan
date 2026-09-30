// Node test of Particles ambient logic (no GPU): leaves never go below ground / NaN, rest on the lake, splashes stay near
// the camera, dust amount sane. Stubs a minimal canvas for the leaf texture.  usage: node tools/d/particles.test.mjs
const ctx2d = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const THREE = await import('three');
const { Particles } = await import('../../src/fx/particles.js');
const { heightAt, WORLD } = await import('../../src/world/heightfield.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const scene = new THREE.Scene(); const p = new Particles(scene);
const cam = new THREE.PerspectiveCamera(); 
const run = (x, z, secs, rain, env) => { cam.position.set(x, heightAt(x, z) + 1.6, z); for (let i = 0; i < secs * 30; i++) p.update(1 / 30, cam, rain, env); };
const env = { night: 0, sunDir: new THREE.Vector3(0.3, 0.8, 0.2).normalize(), wind: new THREE.Vector2(0.6, 0.3) };
run(6, 18, 40, 0, env);
let below = 0, nan = 0, air = 0;
for (const L of p.leafState) { if (!Number.isFinite(L.p.y)) nan++; if (L.p.y > -900 && L.p.y < Math.max(L.ground, WORLD.waterLevel) - 0.02) below++; if (L.p.y > L.ground + 0.05 && L.p.y < 1e8) air++; }
ok(nan === 0, 'no NaN leaves'); ok(below === 0, 'no leaf below ground (' + below + ')'); ok(air > 5, 'some leaves in the air (' + air + ')');
// shore: leaves over the lake float at water level
run(-10, -70 + 60, 40, 0, env); // near shore
let under = 0; for (const L of p.leafState) if (L.ground < WORLD.waterLevel && L.p.y < WORLD.waterLevel - 0.02 && L.p.y > -900) under++;
ok(under === 0, 'no leaf sunk into the lake (' + under + ')');
// teleport: far leaves are recycled around the new position
run(120, 120, 2, 0, env);
let far = 0; for (const L of p.leafState) if (L.p.y > -900 && (Math.abs(L.p.x - 120) > 20 || Math.abs(L.p.z - 120) > 20)) far++;
ok(far === 0, 'leaves recycled after teleport (' + far + ' left behind)');
// landed leaves must touch the surface under their FINAL position (not the spawn point)
run(30, 40, 60, 0, env);
let hover = 0, landed = 0; for (const L of p.leafState) if (L.landed) { landed++; const f = Math.max(heightAt(L.p.x, L.p.z), WORLD.waterLevel); if (Math.abs(L.p.y - f) > 0.06) hover++; }
ok(landed > 5 && hover === 0, `landed leaves sit on the surface (${hover}/${landed} off)`);
// rain splashes
run(6, 18, 3, 1, env);
ok(p.splash.visible, 'splash visible in rain');
let sfar = 0; for (let i = 0; i < p.splashN; i++) { const dx = p.splashPos[i * 3] - 6, dz = p.splashPos[i * 3 + 2] - 18; if (Math.hypot(dx, dz) > 12.5) sfar++; }
ok(sfar === 0, 'splashes near player (' + sfar + ')');
run(6, 18, 1, 0, env); ok(!p.splash.visible, 'splash hidden when dry');
// dust
run(6, 18, 1, 0, env); ok(p.dust.visible && p.dustU.uAmt.value > 0.1, 'dust by day ' + p.dustU.uAmt.value.toFixed(2));
run(6, 18, 1, 0, { ...env, night: 1 }); ok(!p.dust.visible, 'no dust at night');
// no env at all (older main.js)
try { p.env = undefined; p.update(1 / 30, cam, 0); ok(true, 'update without env'); } catch (e) { ok(false, 'update without env: ' + e.message); }
// chips cap
for (let i = 0; i < 30; i++) p.chips(new THREE.Vector3(6, heightAt(6, 18), 18)); ok(p.chipsList.length <= 120, 'chip cap');
process.exitCode = fail ? 1 : 0;
