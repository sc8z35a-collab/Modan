// Node test for Campfire.update(): fuel/lit state machine, emissive/halo values finite, smoke opacity bounded,
// sparks recycled, no NaN with bad dt / wind. Canvas stubbed.
const ctx2d = new Proxy({}, { get: (t, k) => (k.startsWith('create') ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
globalThis.window = { devicePixelRatio: 1 };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };
const THREE = await import('three');
const { Campfire } = await import('../../src/fx/fire.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const f = new Campfire(new THREE.Scene(), new THREE.Vector3(6, 1.6, 18));
const fin = () => [f.light.intensity, f.fill.intensity, f.emberU.uEmb.value, f.halo.material.opacity, ...f.smoke.map((s) => s.material.opacity), ...f.sparks].every(Number.isFinite);
for (let i = 0; i < 300; i++) f.update(1 / 30); ok(!f.lit && f.intensity < 0.01 && !f.embers.visible, 'cold unlit fire is dark');
f.addFuel(0.02); ok(!f.ignite(), 'cannot ignite with almost no fuel');
f.addFuel(1); ok(f.ignite(), 'ignite with fuel');
for (let i = 0; i < 30 * 20; i++) f.update(1 / 30, new THREE.Vector2(0.6, 0.3), 0); ok(f.intensity > 0.8 && f.embers.visible && f.halo.visible, 'burning after 20s (I=' + f.intensity.toFixed(2) + ')');
ok(fin(), 'all fx values finite while burning');
ok(f.smoke.every((s) => s.material.opacity <= 0.33 + 1e-6 && s.material.opacity >= 0), 'smoke opacity in [0,0.33]');
const c = f.smoke[0].material.color; ok(c.r <= 1.5 && c.g >= 0 && c.b >= 0, 'smoke color sane ' + c.getHexString());
let alive = 0; for (let i = 0; i < f.sparkCount; i++) if (f.sparkLife[i] > 0) alive++; ok(alive > 3 && alive < f.sparkCount, 'sparks alive ' + alive);
// rain accelerates fuel burn, fire dies out
for (let i = 0; i < 30 * 700; i++) f.update(1 / 30, undefined, 1);
ok(!f.lit && f.fuel === 0, 'fire burns out (fuel ' + f.fuel.toFixed(3) + ')');
for (let i = 0; i < 30 * 5; i++) f.update(1 / 30); ok(f.emberU.uEmb.value < 0.05 || !f.embers.visible, 'embers fade after burn-out');
// bad inputs
f.update(NaN); f.update(1 / 30, { x: NaN, y: 0 }); ok(true, 'no throw on NaN dt / wind');
f.addFuel(1); f.ignite(); f.update(NaN); for (let i = 0; i < 10; i++) f.update(1 / 30);
ok(fin() && Number.isFinite(f.fuel) && Number.isFinite(f.intensity), 'state finite after NaN dt (fuel ' + f.fuel + ', I ' + f.intensity + ')');
process.exitCode = fail ? 1 : 0;
