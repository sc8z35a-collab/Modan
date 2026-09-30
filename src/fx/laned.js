// Lane D integration hub: wires the field guide, layered ambience, weather-aware water/particles and the moon
// phase into the game WITHOUT touching main.js beyond two lines:
//   init():   this.laneD = installLaneD(this);   (after this.ui / this.interact exist)
//   frame():  this.laneD?.update(dt);            (anywhere in frame(), before rendering)
// Everything here is defensive: a missing system is skipped, never throws into the frame loop.
import * as THREE from 'three';
import { FieldGuide } from '../ui/fieldguide.js';
import { lakeDist } from '../world/heightfield.js';

export function installLaneD(game) {
  const g = game;
  const guide = new FieldGuide(g);
  g.fieldGuide = guide;
  if (g.audio) g.audio.onCall = (kind) => guide.heard(kind);

  // HUD button (next to 📷 / ☰) + menu button. Created from here so index.html stays untouched.
  const tr = document.getElementById('topright');
  if (tr && !document.getElementById('btnGuide')) {
    const b = document.createElement('button');
    b.className = 'icon-btn'; b.id = 'btnGuide'; b.title = '図鑑'; b.textContent = '📖';
    b.onclick = () => { if (g.photo || !g.started) return; g.audio?.click?.(); guide.open(); };
    tr.insertBefore(b, tr.firstChild);
  }
  const mb = document.querySelector('#menu .menu-btns');
  if (mb && !document.getElementById('btnGuideMenu')) {
    const b = document.createElement('button');
    b.className = 'btn-ghost'; b.id = 'btnGuideMenu'; b.textContent = '📖 図鑑';
    b.onclick = () => { g.audio?.click?.(); guide.open(); };
    mb.insertBefore(b, mb.firstChild);
  }
  // keyboard: G opens / closes the guide
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'g' || e.key === 'G') && g.started && !g.photo && !e.repeat && !(e.target instanceof HTMLInputElement)) guide.toggle();
  });

  const fwd = new THREE.Vector3(), toF = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3();
  const env = { night: 0, sunDir: new THREE.Vector3(0, 1, 0), wind: null };
  const extra = { hours: 12, dusk: 0, firePan: 0 };
  if (g.particles) g.particles.env = env;
  if (g.water && g.particles) g.water.extraHide = [g.particles.splash, g.particles.dust, g.particles.leaves].filter(Boolean);
  if (g.audio) g.audio.extra = extra;

  return {
    guide,
    update(dt) {
      try {
        const s = g.state, sky = g.sky;
        if (sky && s) sky.setDay?.(s.day);
        const night = sky?.info?.night ?? 0;
        env.night = night;
        if (sky?.sunDir) env.sunDir.copy(sky.sunDir);
        env.wind = g.world?.U?.uWind?.value || null;
        if (env.wind) g.water?.setWind?.(env.wind);
        g.water?.setRain?.(g.rain || 0);
        // audio extras: fire stereo position relative to where the camera looks
        extra.hours = s?.hours ?? 12; extra.dusk = sky?.info?.dusk ?? 0;
        if (g.fire && g.camera) {
          g.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
          right.crossVectors(fwd, up);
          toF.copy(g.fire.position).sub(g.camera.position); toF.y = 0;
          const l = toF.length(); extra.firePan = l > 1e-3 ? toF.dot(right) / l : 0;
        }
        const p = g.player?.pos;
        if (p && g.started && !g.paused) guide.update(dt, { x: p.x, z: p.z, night, hours: s?.hours, lakeDist: lakeDist(p.x, p.z), rain: g.rain || 0 });
      } catch (e) {
        if (!this._warned) { this._warned = true; console.warn('[laneD] update failed', e); }
      }
    },
  };
}
