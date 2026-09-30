// Node test for Water (no GPU; renderer stubbed): reflection RT sizing (aspect kept, capped, 0-size ignored),
// ripple ring buffer, NaN ripples ignored, rain derived from cloud cover / explicit setRain, wind normalised.
globalThis.window = { devicePixelRatio: 1 };
const THREE = await import('three');
const { Water } = await import('../../src/world/water.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const r = { capabilities: { getMaxAnisotropy: () => 8, maxTextureSize: 4096 } };
const wd = { tex: null, res: 256, size: 720 };
const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0, 0.003);
const w = new Water(r, scene, new THREE.PerspectiveCamera(), wd, 0.6);
const sz = () => [w.rt.width, w.rt.height];
w.resize(1830, 824); let [a, b] = sz(); ok(Math.abs(a / b - 1830 / 824) < 0.02, `aspect kept ${a}x${b}`);
w.resize(7680, 3240); [a, b] = sz(); ok(Math.max(a, b) <= 2048 && Math.abs(a / b - 7680 / 3240) < 0.02, `4K capped ${a}x${b}`);
w.resize(0, 0); ok(sz()[0] === a, 'zero size ignored'); w.resize(NaN, 400); ok(sz()[0] === a, 'NaN size ignored');
w.resize(200, 90); [a, b] = sz(); ok(Math.min(a, b) >= 255, `tiny window min side 256 (${a}x${b})`);
for (let i = 0; i < 20; i++) w.addRipple(i, i, 1); ok(w.ripples.every((v) => Number.isFinite(v.x)), 'ripple ring ok');
w.addRipple(NaN, 0); ok(w.ripples.every((v) => Number.isFinite(v.x) && Number.isFinite(v.y)), 'NaN ripple ignored');
const sky = { sunDir: new THREE.Vector3(0, 1, 0), sun: { color: new THREE.Color(1, 1, 1), intensity: 3 }, info: { night: 0 }, uniforms: { uCloud: { value: 0.9 } } };
w.update(0.016, sky); ok(Math.abs(w.uniforms.uRain.value - 1) < 1e-6, 'rain from clouds (0.9 -> 1)');
sky.uniforms.uCloud.value = 0.35; w.update(0.016, sky); ok(w.uniforms.uRain.value === 0, 'no rain at base clouds');
w.setRain(0.4); w.update(0.016, sky); ok(Math.abs(w.uniforms.uRain.value - 0.4) < 1e-6, 'explicit setRain wins');
w.setWind({ x: 3, y: 4 }); const wv = w.uniforms.uWindDir.value; ok(Math.abs(wv.length() - 1) < 1e-6, 'wind normalised');
w.setWind({ x: 0, y: 0 }); ok(Number.isFinite(wv.x) && Number.isFinite(wv.y), 'zero wind no NaN');
process.exitCode = fail ? 1 : 0;
