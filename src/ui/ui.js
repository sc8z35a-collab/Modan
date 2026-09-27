import { ITEMS } from '../game/state.js';

export class UI {
  constructor(game) {
    this.g = game;
    this.$ = (id) => document.getElementById(id);
    this.toastQ = []; this.toastT = 0;
    this.lastQuest = -1;
  }
  refresh() {
    const s = this.g.state;
    this.$('clockTime').textContent = s.timeString();
    this.$('clockDay').textContent = `${s.day}日目`;
    const setBar = (id, v) => {
      const root = this.$(id), el = root.querySelector('i');
      const w = Math.round((Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0) * 100) + '%';
      if (el.style.width !== w) el.style.width = w;
      root.classList.toggle('low', v < 0.25);
    };
    setBar('stHunger', s.hunger); setBar('stWarm', s.warmth); setBar('stEnergy', s.energy);
    const q = s.quest;
    if (this.lastQuest !== s.questIdx) {
      this.lastQuest = s.questIdx;
      this.$('questTitle').textContent = q.title; this.$('questDesc').textContent = q.desc;
      const el = this.$('quest'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    // only touch the DOM when the inventory changed (runs twice a second); unknown keys from old saves are skipped
    const html = Object.entries(s.inv).filter(([k, n]) => n > 0 && ITEMS[k]).map(([k, n]) => `<div class="slot"><span>${ITEMS[k].icon}</span><b>${n}</b></div>`).join('');
    if (html !== this.lastInv) { this.lastInv = html; this.$('inventory').innerHTML = html; }
  }
  toast(msg) {
    const el = this.$('toast');
    const d = document.createElement('div'); d.className = 't'; d.textContent = msg;
    el.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    for (const c of [...el.children]) if (c !== d && c.textContent === msg) c.remove(); // dedupe spam
    while (el.children.length > 3) el.firstChild.remove();
  }
  questDone(q) {
    this.toast(`✔ クエスト達成：${q.title}`);
    this.g.audio.success();
  }
  showCatch(fish) {
    const el = document.createElement('div'); el.className = 'catch';
    document.querySelectorAll('#hud .catch').forEach((c) => c.remove()); // don't stack banners
    el.innerHTML = '<div class="c-t">釣れた！</div><div class="c-n"></div><div class="c-s"></div>';
    el.querySelector('.c-n').textContent = fish.name; el.querySelector('.c-s').textContent = `${fish.size} cm`;
    document.getElementById('hud').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3200);
  }
  fade(on, cb) {
    const f = this.$('fade'); f.classList.toggle('on', on);
    clearTimeout(this.fadeT);
    if (cb) this.fadeT = setTimeout(cb, 1300);
  }
}
