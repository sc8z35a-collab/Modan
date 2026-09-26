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
      const el = this.$(id).querySelector('i');
      el.style.width = Math.round(v * 100) + '%';
      this.$(id).classList.toggle('low', v < 0.25);
    };
    setBar('stHunger', s.hunger); setBar('stWarm', s.warmth); setBar('stEnergy', s.energy);
    const q = s.quest;
    if (this.lastQuest !== s.questIdx) {
      this.lastQuest = s.questIdx;
      this.$('questTitle').textContent = q.title; this.$('questDesc').textContent = q.desc;
      const el = this.$('quest'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    const inv = this.$('inventory');
    inv.innerHTML = Object.entries(s.inv).filter(([, n]) => n > 0).map(([k, n]) => `<div class="slot"><span>${ITEMS[k].icon}</span><b>${n}</b></div>`).join('');
  }
  toast(msg) {
    const el = this.$('toast');
    const d = document.createElement('div'); d.className = 't'; d.textContent = msg;
    el.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2600);
    setTimeout(() => d.remove(), 3200);
    while (el.children.length > 3) el.firstChild.remove();
  }
  questDone(q) {
    this.toast(`✔ クエスト達成：${q.title}`);
    this.g.audio.success();
  }
  showCatch(fish) {
    const el = document.createElement('div'); el.className = 'catch';
    el.innerHTML = `<div class="c-t">釣れた！</div><div class="c-n">${fish.name}</div><div class="c-s">${fish.size} cm</div>`;
    document.getElementById('hud').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600); setTimeout(() => el.remove(), 3200);
  }
  fade(on, cb) {
    const f = this.$('fade'); f.classList.toggle('on', on);
    if (cb) setTimeout(cb, 1300);
  }
}
