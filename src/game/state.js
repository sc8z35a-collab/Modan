// Game state: time, survival stats, inventory, quest chain, save/load.
export const ITEMS = {
  wood: { name: '薪', icon: '🪵' },
  mushroom: { name: 'キノコ', icon: '🍄' },
  berry: { name: 'ベリー', icon: '🫐' },
  fish: { name: '生魚', icon: '🐟' },
  cooked: { name: '焼き魚', icon: '🍢' },
  coffee: { name: 'コーヒー', icon: '☕' },
};

export const QUESTS = [
  { id: 'wood', title: '薪を集めよう', desc: '森で落ちている枝を5本拾おう（倒木を斧で割ると一気に集まる）', check: (s) => s.inv.wood >= 5 || s.flags.fed },
  { id: 'feed', title: '焚き火台に薪をくべよう', desc: 'キャンプ中央の石組みの焚き火台で「薪をくべる」', check: (s) => s.flags.fed },
  { id: 'ignite', title: '火をおこそう', desc: '焚き火台で「火をつける」— ファイヤースターターを素早く擦ろう', check: (s) => s.flags.ignited },
  { id: 'fish', title: '湖で魚を釣ろう', desc: '小道を下った先の桟橋の先端で釣りをしよう', check: (s) => s.stats.fishCaught >= 1 },
  { id: 'cook', title: '魚を焼いて食べよう', desc: '燃えている焚き火で魚を焼き、ちょうどいい焼き加減で食べよう', check: (s) => s.flags.ateCooked },
  { id: 'night', title: '星空を撮ろう', desc: '夜になったら📷写真モードで星空を撮影しよう（時間は進む）', check: (s) => s.flags.nightPhoto },
  { id: 'sleep', title: 'テントで眠ろう', desc: '夜、テントに入って朝まで眠ろう', check: (s) => s.flags.slept },
  { id: 'free', title: '自由にキャンプを楽しもう', desc: '釣り・採集・焚き火・コーヒー… 湖畔の森でのんびり過ごそう', check: () => false },
];

export class GameState {
  constructor() { this.reset(); }
  reset() {
    this.hours = 15.5;    // start mid afternoon for golden hour soon
    this.day = 1;
    this.hunger = 0.7; this.warmth = 0.85; this.energy = 0.8;
    this.inv = { wood: 0, mushroom: 0, berry: 0, fish: 0, cooked: 0, coffee: 0 };
    this.stats = { fishCaught: 0, biggestFish: 0, woodGathered: 0 };
    this.flags = {};
    this.questIdx = 0;
    this.fire = { fuel: 0, lit: false };
    this.timeScale = 1; // game minutes per real second
  }
  get quest() { return QUESTS[Math.min(this.questIdx, QUESTS.length - 1)]; }
  advanceQuests(onComplete) {
    let changed = false;
    while (this.questIdx < QUESTS.length - 1 && QUESTS[this.questIdx].check(this)) {
      onComplete?.(QUESTS[this.questIdx]); this.questIdx++; changed = true;
    }
    return changed;
  }
  add(item, n = 1) { this.inv[item] = Math.max(0, (this.inv[item] || 0) + n); }
  timeString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  save(extra = {}) {
    const d = { v: 1, hours: this.hours, day: this.day, hunger: this.hunger, warmth: this.warmth, energy: this.energy, inv: this.inv, stats: this.stats, flags: this.flags, questIdx: this.questIdx, fire: this.fire, ...extra };
    localStorage.setItem('modan-camp-save', JSON.stringify(d));
  }
  static hasSave() { return !!localStorage.getItem('modan-camp-save'); }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem('modan-camp-save'));
      if (!d) return null;
      Object.assign(this, { hours: d.hours, day: d.day, hunger: d.hunger, warmth: d.warmth, energy: d.energy, questIdx: d.questIdx });
      Object.assign(this.inv, d.inv); Object.assign(this.stats, d.stats); Object.assign(this.flags, d.flags);
      this.fire = d.fire || this.fire;
      return d;
    } catch { return null; }
  }
}
