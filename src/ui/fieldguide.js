// Field guide (図鑑): real Creative-Commons photos of the fish, birds, insects, trees, mushrooms and plants
// found around the lake. Entries unlock as the player meets them (catch a fish, hear an owl at night, pick a
// mushroom...). Photos + attribution come from public/assets/photos/photos.json (tools/fetch-photos.mjs).
//
// API (for main.js / interactions.js):
//   const fg = new FieldGuide(game); fg.open(); fg.close(); fg.toggle();
//   fg.unlock('rainbow')        -> true if newly unlocked (shows a toast)
//   fg.unlockFish('ニジマス', 42) -> maps the in-game fish name, records the biggest size
//   fg.isOpen
// Progress persists in localStorage ('modan-fieldguide').
import './fieldguide.css';

const BASE = import.meta.env?.VITE_ASSET_BASE || import.meta.env?.BASE_URL || './';
const KEY = 'modan-fieldguide';

export const GUIDE = [
  // ---- fish (unlocked by catching)
  { id: 'rainbow', cat: 'fish', name: 'ニジマス', sci: 'Oncorhynchus mykiss', hint: '桟橋や岸辺から釣ろう',
    text: '体側の赤紫の帯と黒い小斑点が特徴。北米原産で、冷たく澄んだ湖に放流され定着している。引きが強く、ジャンプすることも。' },
  { id: 'yamame', cat: 'fish', name: 'ヤマメ', sci: 'Oncorhynchus masou masou', hint: '湖で釣ろう（やや珍しい）',
    text: '体側に並ぶ小判型の「パーマーク」が美しい渓流の女王。警戒心が強く、影を落とすとすぐに逃げてしまう。' },
  { id: 'iwana', cat: 'fish', name: 'イワナ', sci: 'Salvelinus leucomaenis', hint: '湖で釣ろう（珍しい）',
    text: '白〜橙色の斑点を持つ、日本で最も冷たい水域に棲むイワナ属の魚。岩陰に潜み、落ちてきた虫を大きな口で丸呑みにする。' },
  { id: 'brown', cat: 'fish', name: 'ブラウントラウト', sci: 'Salmo trutta', hint: '湖の主。とても珍しい',
    text: 'ヨーロッパ原産。黒と朱色の斑点をもち、80cmを超える大物も。夕暮れ時に活発になる、湖の「主」。' },
  // ---- birds & insects (unlocked by sound / time of day)
  { id: 'loon', cat: 'bird', name: 'ハシグロアビ', sci: 'Gavia immer', hint: '夜の湖面に耳を澄まそう',
    text: '夜の湖に響く、長く尾を引く哀しげな鳴き声の主。潜水が得意で、魚を追って水深60mまで潜ることもある。' },
  { id: 'owl', cat: 'bird', name: 'フクロウ', sci: 'Strix uralensis', hint: '夜の森で「ホーホー」という声を聞こう',
    text: '「ゴロスケホーホー」と低く鳴く森の番人。羽音をほとんど立てずに飛び、夜の闇でネズミを狩る。' },
  { id: 'woodpecker', cat: 'bird', name: 'アカゲラ', sci: 'Dendrocopos major', hint: '昼の森でドラミングを聞こう',
    text: '白黒の羽と下腹の赤が鮮やかなキツツキ。くちばしで幹を高速で叩く「ドラミング」で縄張りを主張する。' },
  { id: 'uguisu', cat: 'bird', name: 'ウグイス', sci: 'Horornis diphone', hint: '朝の森でさえずりを聞こう',
    text: '「ホーホケキョ」のさえずりで知られるが、姿は地味な緑褐色。藪の中を好み、なかなか姿を見せない。' },
  { id: 'firefly', cat: 'bird', name: 'ゲンジボタル', sci: 'Luciola cruciata', hint: '夜、水辺の光を見つけよう',
    text: '初夏の夜、水辺をゆっくりと明滅しながら飛ぶ。幼虫は清流に棲み、カワニナを食べて育つ。きれいな水の証。' },
  // ---- trees & plants (unlocked by walking in the forest / gathering)
  { id: 'spruce', cat: 'plant', name: 'エゾマツ', sci: 'Picea jezoensis', hint: '森を歩こう',
    text: '円錐形に整った樹形の常緑針葉樹。冷涼な山地の森をつくり、湖畔の森の暗い緑の大部分はこの木。' },
  { id: 'pine', cat: 'plant', name: 'アカマツ', sci: 'Pinus densiflora', hint: '森を歩こう',
    text: '赤褐色の樹皮がはがれるように割れる松。乾いた尾根や痩せ地に強い。松ぼっくりは焚き付けに最適。' },
  { id: 'birch', cat: 'plant', name: 'シラカバ', sci: 'Betula platyphylla', hint: '湖岸の白い木を探そう',
    text: '白い樹皮が目印。樹皮は油分を含み、濡れていても火がつくため、昔から焚き付けとして重宝されてきた。' },
  { id: 'porcini', cat: 'plant', name: 'ヤマドリタケ', sci: 'Boletus edulis', hint: 'キノコを採ろう',
    text: '別名ポルチーニ。肉厚で香り高い、世界で愛される食用キノコ。針葉樹やカバノキの根と共生する。' },
  { id: 'chanterelle', cat: 'plant', name: 'アンズタケ', sci: 'Cantharellus cibarius', hint: 'キノコを採ろう',
    text: '杏のような甘い香りをもつ黄色いキノコ。ひだに見えるのは浅いしわ。バターソテーが絶品。' },
  { id: 'bilberry', cat: 'plant', name: 'ビルベリー', sci: 'Vaccinium myrtillus', hint: 'ベリーを摘もう',
    text: '森の下草に実る小さな青黒い果実。果肉まで紫色で、甘酸っぱい。野生のブルーベリーの仲間。' },
  { id: 'fern', cat: 'plant', name: 'クサソテツ', sci: 'Matteuccia struthiopteris', hint: '湿った林床を歩こう',
    text: '漏斗状に葉を広げるシダ。春の若芽「コゴミ」は山菜として人気。湿った林床に群生する。' },
  { id: 'waterlily', cat: 'plant', name: 'ヒツジグサ', sci: 'Nymphaea tetragona', hint: '湖岸をよく見よう',
    text: '日本に自生する唯一のスイレン。未の刻（午後2時頃）に花を開くことからこの名がついた。' },
];
const CATS = [['all', 'すべて'], ['fish', '魚'], ['bird', '鳥・虫'], ['plant', '植物・キノコ']];
const FISH_ID = { 'ニジマス': 'rainbow', 'ヤマメ': 'yamame', 'イワナ': 'iwana', 'ブラウントラウト': 'brown' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class FieldGuide {
  constructor(game) {
    this.g = game;
    this.isOpen = false;
    this.cat = 'all';
    this.data = this.load();
    this.meta = {};
    this.metaP = fetch(`${BASE}assets/photos/photos.json`).then((r) => (r.ok ? r.json() : {})).then((m) => { this.meta = m || {}; }).catch(() => {});
    this.build();
  }

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { seen: (d && typeof d.seen === 'object' && d.seen) || {}, best: (d && typeof d.best === 'object' && d.best) || {} };
    } catch { return { seen: {}, best: {} }; }
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage disabled */ } }

  get count() { return GUIDE.filter((e) => this.data.seen[e.id]).length; }

  build() {
    const root = document.createElement('div');
    root.id = 'fieldguide'; root.className = 'fg hidden';
    root.innerHTML = `
      <div class="fg-book" role="dialog" aria-label="図鑑">
        <header class="fg-head">
          <div class="fg-title">湖畔の森 図鑑<small>Field Guide</small></div>
          <div class="fg-count"></div>
          <button class="fg-x" aria-label="閉じる">✕</button>
        </header>
        <nav class="fg-tabs">${CATS.map(([k, n]) => `<button data-cat="${k}">${n}</button>`).join('')}</nav>
        <div class="fg-grid"></div>
        <div class="fg-detail hidden"></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.grid = root.querySelector('.fg-grid');
    this.detail = root.querySelector('.fg-detail');
    root.querySelector('.fg-x').onclick = () => this.close();
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
    root.querySelectorAll('.fg-tabs button').forEach((b) => { b.onclick = () => { this.cat = b.dataset.cat; this.render(); this.g?.audio?.click?.(); }; });
    // game input listens on window: keep drags/taps inside the book from turning the camera / firing actions
    for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'wheel']) root.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    this.onKey = (e) => { if (this.isOpen && e.key === 'Escape') { e.stopPropagation(); this.detail.classList.contains('hidden') ? this.close() : this.hideDetail(); } };
    window.addEventListener('keydown', this.onKey, true);
  }

  photoUrl(id) { return `${BASE}assets/photos/${id}.webp`; }

  render() {
    this.root.querySelectorAll('.fg-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.cat === this.cat));
    this.root.querySelector('.fg-count').textContent = `${this.count} / ${GUIDE.length} 発見`;
    const list = GUIDE.filter((e) => this.cat === 'all' || e.cat === this.cat);
    this.grid.innerHTML = list.map((e) => {
      const seen = !!this.data.seen[e.id];
      return `<button class="fg-card ${seen ? 'seen' : 'locked'}" data-id="${e.id}">
        <div class="fg-ph">${seen ? `<img loading="lazy" decoding="async" alt="${esc(e.name)}" src="${this.photoUrl(e.id)}">` : '<span>?</span>'}</div>
        <div class="fg-nm">${seen ? esc(e.name) : '？？？'}</div>
        ${seen && this.data.best[e.id] ? `<div class="fg-best">最大 ${this.data.best[e.id]}cm</div>` : ''}
      </button>`;
    }).join('');
    this.grid.querySelectorAll('.fg-card').forEach((c) => { c.onclick = () => this.showDetail(c.dataset.id); });
  }

  showDetail(id) {
    const e = GUIDE.find((x) => x.id === id); if (!e) return;
    const seen = !!this.data.seen[id];
    this.g?.audio?.click?.();
    if (!seen) {
      this.detail.innerHTML = `<div class="fg-d-in locked"><div class="fg-d-ph"><span>?</span></div><div class="fg-d-tx">
        <h3>まだ見つけていない</h3><p class="fg-hint">ヒント：${esc(e.hint)}</p><button class="fg-back">もどる</button></div></div>`;
    } else {
      const m = this.meta[id];
      const credit = m ? `写真: ${esc(m.author)} / <a href="${esc(m.licenseUrl || m.source)}" target="_blank" rel="noopener">${esc(m.license)}</a> — <a href="${esc(m.source)}" target="_blank" rel="noopener">Wikimedia Commons</a>` : '写真: Wikimedia Commons';
      const best = this.data.best[id] ? `<p class="fg-rec">🎣 あなたの最大記録：<b>${this.data.best[id]} cm</b></p>` : '';
      this.detail.innerHTML = `<div class="fg-d-in"><div class="fg-d-ph"><img alt="${esc(e.name)}" src="${this.photoUrl(id)}"></div><div class="fg-d-tx">
        <h3>${esc(e.name)}</h3><div class="fg-sci">${esc(e.sci)}</div><p>${esc(e.text)}</p>${best}
        <div class="fg-credit">${credit}</div><button class="fg-back">もどる</button></div></div>`;
    }
    this.detail.classList.remove('hidden');
    this.detail.querySelector('.fg-back').onclick = () => this.hideDetail();
  }
  hideDetail() { this.detail.classList.add('hidden'); this.detail.innerHTML = ''; }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.hideDetail(); this.render();
    this.root.classList.remove('hidden');
    this.g?.input?.reset?.();
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.hideDetail();
    this.g?.input?.reset?.();
  }
  toggle() { this.isOpen ? this.close() : this.open(); }

  unlock(id, quiet = false) {
    const e = GUIDE.find((x) => x.id === id);
    if (!e || this.data.seen[id]) return false;
    this.data.seen[id] = Date.now();
    this.save();
    if (!quiet) this.g?.ui?.toast?.(`📖 図鑑に「${e.name}」が追加された (${this.count}/${GUIDE.length})`);
    if (this.isOpen) this.render();
    return true;
  }

  unlockFish(name, size) {
    const id = FISH_ID[name]; if (!id) return false;
    const n = this.unlock(id);
    if (Number.isFinite(size) && size > (this.data.best[id] || 0)) { this.data.best[id] = size; this.save(); }
    return n;
  }
}
