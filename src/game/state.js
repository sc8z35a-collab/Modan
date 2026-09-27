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

const SAVE_KEY = 'modan-camp-save';
const SAVE_VERSION = 1;

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
    // normalise first: float error could produce "15:60" / "24:00"
    const total = Math.floor((((this.hours % 24) + 24) % 24) * 60 + 1e-6) % 1440;
    const h = Math.floor(total / 60), m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  save(extra = {}) {
    const d = { v: SAVE_VERSION, hours: this.hours, day: this.day, hunger: this.hunger, warmth: this.warmth, energy: this.energy, inv: this.inv, stats: this.stats, flags: this.flags, questIdx: this.questIdx, fire: this.fire, ...extra };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); return true; } catch { return false; } // quota / private mode
  }
  static hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || typeof d !== 'object') return null;
      // validate every field: a corrupted / older save must not inject NaN / undefined into the simulation
      const num = (v, def, lo = -Infinity, hi = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
      this.hours = num(d.hours, this.hours, 0, 23.999);
      this.day = Math.max(1, Math.floor(num(d.day, this.day)));
      this.hunger = num(d.hunger, this.hunger, 0, 1);
      this.warmth = num(d.warmth, this.warmth, 0, 1);
      this.energy = num(d.energy, this.energy, 0, 1);
      this.questIdx = Math.floor(num(d.questIdx, this.questIdx, 0, QUESTS.length - 1));
      if (d.inv && typeof d.inv === 'object') for (const k of Object.keys(this.inv)) this.inv[k] = Math.floor(num(d.inv[k], 0, 0, 9999));
      if (d.stats && typeof d.stats === 'object') for (const k of Object.keys(this.stats)) this.stats[k] = num(d.stats[k], this.stats[k], 0);
      if (d.flags && typeof d.flags === 'object') Object.assign(this.flags, d.flags);
      if (d.fire && typeof d.fire === 'object') this.fire = { fuel: num(d.fire.fuel, 0, 0, 1.2), lit: !!d.fire.lit };
      return d;
    } catch { return null; }
  }
}
