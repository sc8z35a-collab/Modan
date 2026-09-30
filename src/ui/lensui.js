// Lens bar UI: log-scaled vertical zoom strip (0.5x .. 40x), preset chips, transient readout.
import { ZOOM, PRESETS } from '../core/lens.js';

const L0 = Math.log(ZOOM.min), L1 = Math.log(ZOOM.max);
const toT = (z) => (Math.log(z) - L0) / (L1 - L0); // 0 bottom .. 1 top
const fromT = (t) => Math.exp(L0 + Math.min(1, Math.max(0, t)) * (L1 - L0));

export class LensUI {
  constructor(game) {
    this.g = game; this.lens = game.R.lens;
    const $ = (id) => document.getElementById(id);
    this.track = $('lensTrack'); this.knob = $('lensKnob'); this.fill = $('lensFill');
    this.read = $('lensRead'); this.rz = $('lensZ'); this.rmm = $('lensMM'); this.rmode = $('lensMode');
    this.cross = $('crosshair');
    const pr = $('lensPresets');
    this.btns = PRESETS.map((p) => {
      const b = document.createElement('button');
      b.textContent = p < 1 ? '.5' : p + '';
      b.dataset.z = p; if (p > ZOOM.maxOptical) b.classList.add('dg');
      const go = (e) => { e.preventDefault(); e.stopPropagation(); this.g.audio?.click?.(); this.lens.setZoom(p); };
      b.addEventListener('touchstart', go, { passive: false });
      b.addEventListener('mousedown', (e) => { if (e.button === 0) go(e); });
      pr.appendChild(b);
      return b;
    });
    // the digital-zone marker covers the top part of the track above 20x
    this.track.style.setProperty('--dz', `${(1 - toT(ZOOM.maxOptical)) * 100}%`);
    const zoneEl = document.createElement('style');
    zoneEl.textContent = `#lensTrack::after{height:${(1 - toT(ZOOM.maxOptical)) * 100}%}`;
    document.head.appendChild(zoneEl);

    // drag on the strip = absolute zoom position
    const setFromY = (y) => { const r = this.track.getBoundingClientRect(); this.lens.setZoom(fromT(1 - (y - r.top) / r.height)); };
    let dragId = null;
    this.track.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); const t = e.changedTouches[0]; dragId = t.identifier; setFromY(t.clientY); }, { passive: false });
    this.track.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); for (const t of e.changedTouches) if (t.identifier === dragId) setFromY(t.clientY); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === dragId) dragId = null; };
    this.track.addEventListener('touchend', end); this.track.addEventListener('touchcancel', end);
    let md = false;
    this.track.addEventListener('mousedown', (e) => { if (e.button) return; e.stopPropagation(); md = true; setFromY(e.clientY); });
    window.addEventListener('mousemove', (e) => { if (md) setFromY(e.clientY); });
    window.addEventListener('mouseup', () => { md = false; });
    // double-tap the readout area / preset "1" resets; lens changes show the readout
    this.lens.onChange = () => this.poke();
    this.lastShown = -1; this.hideT = 0;
    this.render(true);
  }

  poke() { this.hideT = 1.6; this.read.classList.remove('hidden', 'fade'); }

  update(dt) {
    if (this.hideT > 0) { this.hideT -= dt; if (this.hideT <= 0) this.read.classList.add('fade'); }
    this.render();
  }

  render(force = false) {
    const L = this.lens, z = L.zoom;
    if (!force && Math.abs(z - this.lastShown) < 1e-4) return;
    this.lastShown = z;
    const t = toT(z);
    this.knob.style.top = `${(1 - t) * 100}%`;
    this.fill.style.height = `${t * 100}%`;
    this.fill.classList.toggle('digital', L.digital > 1.001);
    this.rz.textContent = L.label();
    this.rmm.textContent = `${Math.round(L.focalMM)}mm`;
    this.rmode.textContent = L.digital > 1.001 ? `デジタル ${L.digital.toFixed(1)}×` : z < 0.99 ? '超広角' : '';
    const tz = L.target;
    let best = null, bd = 1e9;
    for (const b of this.btns) { const d = Math.abs(Math.log(+b.dataset.z) - Math.log(tz)); if (d < bd) { bd = d; best = b; } }
    for (const b of this.btns) b.classList.toggle('on', b === best && bd < 0.05);
    this.cross.classList.toggle('tele', z >= 5);
  }
}
