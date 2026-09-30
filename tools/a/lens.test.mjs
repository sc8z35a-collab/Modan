// Node unit test for the lens math (no browser). run: node tools/a/lens.test.mjs
import * as THREE from 'three';
import { Lens, ZOOM, PRESETS } from '../../src/core/lens.js';
let fail = 0; const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } else console.log('ok  ', m); };
const cam = new THREE.PerspectiveCamera(64, 640 / 288, 0.1, 100);
const L = new Lens(cam); L.setBaseFov(64);
const tb = Math.tan(THREE.MathUtils.degToRad(32));
for (const z of [0.5, 1, 2, 5, 10, 20]) {
  L.setZoom(z, true); L.apply(true);
  const k = tb / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  ok(Math.abs(k - z) < 1e-6, `optical ${z}x -> magnification ${k.toFixed(4)} (fov ${cam.fov.toFixed(2)}°)`);
}
L.setZoom(40, true); L.apply(true);
ok(Math.abs(L.optical - 20) < 1e-9 && Math.abs(L.digital - 2) < 1e-9, '40x = 20x optical * 2x digital');
ok(L.effect.uniforms.get('uDigital').value === 2, 'digital crop uniform = 2');
L.setZoom(999, true); ok(L.zoom === ZOOM.max, 'clamped to max 40x');
L.setZoom(0.01, true); ok(L.zoom === ZOOM.min, 'clamped to min 0.5x');
L.setZoom(NaN, true); ok(L.zoom === 1, 'NaN -> 1x');
// ultra-wide: panini on, fit scale keeps corners inside the rendered frame
L.setZoom(0.5, true); L.apply(true);
const U = L.effect.uniforms;
ok(U.get('uPanini').value > 0.5, `0.5x panini d=${U.get('uPanini').value.toFixed(2)}`);
{ // effective horizontal FOV of the OUTPUT image after panini: output edge maps back to which view angle?
  const s = U.get('uPaniniS').value, ex = U.get('uExtent').value.x, d = U.get('uPanini').value;
  const x = ex * s, vd = 1 + d, hyp = x * x + vd * vd, iD = x * d, cyl = (-iD * x + vd * Math.sqrt(hyp - iD * iD)) / hyp;
  const rx = x * ((cyl + d) / vd) / cyl; const hf = 2 * Math.atan(rx) * 180 / Math.PI;
  ok(s <= 1 && rx <= ex * 1.001 && hf > 125, `panini fit s=${s.toFixed(3)} -> output horizontal FOV ${hf.toFixed(1)}° (edges inside render)`);
}
ok(cam.fov > 100, `0.5x vertical fov ${cam.fov.toFixed(1)}° (horizontal ${(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect) * 180 / Math.PI).toFixed(1)}°)`);
L.setZoom(1, true); L.apply(true); ok(U.get('uPanini').value === 0, '1x: no panini');
// smoothing converges in log space and does not overshoot
L.setZoom(1, true); L.setZoom(20); let prev = 1, mono = true;
for (let i = 0; i < 120; i++) { L.update(1 / 60); if (L.zoom < prev - 1e-9 || L.zoom > 20 + 1e-9) mono = false; prev = L.zoom; }
ok(mono && L.zoom === 20, 'smooth 1x->20x is monotonic and settles exactly');
// presets stepping
L.setZoom(1, true); const seq = []; for (let i = 0; i < 8; i++) { L.step(1); seq.push(L.target); }
ok(JSON.stringify(seq) === JSON.stringify([2, 5, 10, 20, 40, 40, 40, 40]), 'step up ' + seq.join(','));
L.step(-1); ok(L.target === 20, 'step down from 40 -> 20');
// sensitivity / stabilisation / viewmodel scale
L.setZoom(20, true); ok(Math.abs(L.lookScale() - 1 / Math.pow(20, 0.92)) < 1e-9, `20x look scale ${L.lookScale().toFixed(4)}`);
ok(L.lodBias() === 20, 'lod bias 20 at 20x'); L.setZoom(40, true); ok(L.lodBias() === 20, 'lod bias stays 20 in digital');
L.setZoom(0.5, true); ok(L.lodBias() === 1 && L.viewmodelScale() === 2, 'ultra-wide: bias 1, viewmodel x2');
ok(PRESETS[0] === 0.5 && PRESETS.at(-1) === 40, 'presets 0.5..40');
L.setZoom(40, true); ok(L.label() === '40×' && Math.round(L.focalMM) === 960, `label ${L.label()} ${L.focalMM}mm`);
L.setZoom(0.5, true); ok(L.label() === '.5×', 'label .5×');
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
