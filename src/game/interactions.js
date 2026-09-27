// Interactions + minigames: gathering, chopping, fire lighting, fishing (cast/bite/reel), cooking, coffee, sleeping.
import * as THREE from 'three';
import { WORLD, heightAt, lakeDist } from '../world/heightfield.js';
import { ITEMS } from './state.js';

const FISH = [
  { name: 'ニジマス', min: 25, max: 55, w: 0.45, power: 0.9, color: 0x8a9a7a },
  { name: 'ヤマメ', min: 18, max: 32, w: 0.3, power: 0.7, color: 0x7a8a9a },
  { name: 'イワナ', min: 25, max: 60, w: 0.18, power: 1.05, color: 0x6a6a55 },
  { name: 'ブラウントラウト', min: 40, max: 80, w: 0.07, power: 1.35, color: 0x8a6a40 },
];

export class Interactions {
  constructor(game) {
    this.g = game;
    this.current = null;      // current interaction target
    this.mode = null;         // active minigame
    this.mg = document.getElementById('minigame');
    this.btn = document.getElementById('btnAction');
    this.label = document.getElementById('actLabel');
    this.tmpV = new THREE.Vector3();
    this.busy = false;        // true during sleep fade (blocks re-triggering)
    this.brewing = 0; this.relaxT = 0;
    this.fishPos = new THREE.Vector3();
    this.eatPos = new THREE.Vector3();
    this.buildBobber();
  }

  buildBobber() {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff2a1a, roughness: 0.4 }));
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
    // glow light lives outside the (initially invisible) bobber group: a light becoming visible changes
    // the scene light count and recompiled every material on each cast
    const glow = new THREE.PointLight(0xff6040, 0, 1.2, 2);
    g.add(top, bot); g.visible = false;
    this.g.scene.add(g, glow);
    this.bobber = g; this.bobberGlow = glow;
    const lg = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3()));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false; this.line.visible = false;
    this.g.scene.add(this.line);
  }

  // ---------- find nearby target
  scan() {
    const g = this.g, p = g.player.pos, f3 = g.player.forward();
    const fl = Math.hypot(f3.x, f3.z) || 1;
    const f = { x: f3.x / fl, z: f3.z / fl };
    let best = null, bestScore = 1e9;
    const consider = (t, label, extraOk = true) => {
      if (!extraOk) return;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      if (d > t.radius) return;
      this.tmpV.set(t.pos.x - p.x, 0, t.pos.z - p.z).normalize();
      const facing = this.tmpV.x * f.x + this.tmpV.z * f.z;
      if (facing < 0.2 && d > 1.2) return;
      const score = d - facing * 1.5;
      if (score < bestScore) { bestScore = score; best = { ...t, label: label || t.label, ref: t }; }
    };
    for (const t of g.world.pickups) {
      if (!t.obj.visible) continue;
      if (t.type === 'berry' && t.regrow > 0) continue;
      consider(t);
    }
    for (const t of g.world.choppables) if (t.hp > 0) consider(t);
    // fire
    const fp = g.fire.position;
    const fireT = { type: 'fire', pos: fp, radius: 2.6 };
    // priority: holding any wood used to hide "light fire" / "cook" until ALL wood was burned
    const wood = g.state.inv.wood;
    if (!g.fire.lit && g.fire.fuel > 0.05) consider(fireT, '火をつける');
    else if (wood > 0 && g.fire.fuel < 0.35) consider(fireT, `薪をくべる (${wood})`);
    else if (g.fire.lit && g.state.inv.fish > 0) consider(fireT, '魚を焼く');
    else if (g.fire.lit && g.state.inv.mushroom > 0) consider(fireT, 'キノコを焼く');
    else if (g.fire.lit && !g.state.flags.coffeeToday && !this.brewing) consider(fireT, 'コーヒーを淹れる');
    else if (wood > 0 && g.fire.fuel < 1.1) consider(fireT, `薪をくべる (${wood})`);
    else consider(fireT, 'くつろぐ');
    // tent
    consider({ type: 'tent', pos: g.tentPos, radius: 2.8 }, g.state.hours >= 19 || g.state.hours < 5 ? 'テントで眠る' : 'テントで休む');
    // dock end = fishing
    consider({ type: 'fish', pos: g.dockEnd, radius: 2.4 }, '釣りをする');
    // shore fishing anywhere near water
    const ld = lakeDist(p.x, p.z);
    if (!best && ld > -3 && ld < 3 && heightAt(p.x, p.z) < 0.9) best = { type: 'fish', label: '釣りをする', pos: this.fishPos.copy(p) };
    // eat (threshold raised: with hunger >= 0.85 the cooked fish needed for the quest could never be eaten)
    if (!best && (g.state.inv.cooked > 0 || g.state.inv.berry > 0) && g.state.hunger < 0.95) best = { type: 'eat', label: g.state.inv.cooked > 0 ? '焼き魚を食べる' : 'ベリーを食べる', pos: this.eatPos.copy(p) };
    return best;
  }

  update(dt) {
    this.tickBrew(dt); this.tickRelax(dt);
    if (this.mode) {
      this.mode.update?.(dt); this.updateLine();
      this.bobberGlow.position.copy(this.bobber.position); this.bobberGlow.position.y += 0.06;
      this.bobberGlow.intensity = this.bobber.visible ? 0.35 * this.g.sky.info.night : 0;
      return;
    }
    this.bobberGlow.intensity = 0;
    if (this.busy) { this.current = null; this.btn.classList.add('hidden'); return; }
    this.current = this.scan();
    if (this.current) { this.btn.classList.remove('hidden'); this.label.textContent = this.current.label; }
    else this.btn.classList.add('hidden');
  }

  act() {
    if (this.mode) { this.mode.tap?.(); return; }
    if (this.busy) return;
    const t = this.current; if (!t) return;
    this.current = null; // one action per scan (a double tap used to consume the same pickup twice)
    const g = this.g, s = g.state, a = g.audio;
    switch (t.type) {
      case 'wood': {
        const r = t.ref; const i = g.world.pickups.indexOf(r); if (i < 0) break; // splice(-1) removed the LAST pickup
        r.obj.visible = false; g.scene.remove(r.obj);
        g.world.pickups.splice(i, 1);
        s.add('wood', 1); s.stats.woodGathered++; a.pickup(); g.ui.toast(`${ITEMS.wood.icon} 薪 +1`);
        setTimeout(() => g.world.spawnBranch(), 60000);
        break;
      }
      case 'mushroom': {
        const r = t.ref; const i = g.world.pickups.indexOf(r); if (i < 0) break;
        r.obj.visible = false; g.scene.remove(r.obj);
        g.world.pickups.splice(i, 1);
        s.add('mushroom', 1); a.pickup(); g.ui.toast(`${ITEMS.mushroom.icon} キノコ +1`);
        setTimeout(() => g.world.spawnMushroom(), 120000);
        break;
      }
      case 'berry': {
        const r = t.ref; if (r.regrow > 0) break;
        r.berries.visible = false; r.regrow = 240;
        const n = 2 + ((Math.random() * 3) | 0);
        s.add('berry', n); a.pickup(); g.ui.toast(`${ITEMS.berry.icon} ベリー +${n}`);
        break;
      }
      case 'trunk': if (t.ref.hp > 0) this.startChop(t.ref); break;
      case 'fire': this.fireAction(t.label); break;
      case 'tent': this.sleep(); break;
      case 'fish': this.startFishing(); break;
      case 'eat': {
        if (s.inv.cooked > 0) { s.add('cooked', -1); s.hunger = Math.min(1, s.hunger + 0.45); s.energy = Math.min(1, s.energy + 0.1); g.ui.toast('🍢 おいしい！ 満腹度が回復した'); s.flags.ateCooked = true; }
        else if (s.inv.berry > 0) { s.add('berry', -1); s.hunger = Math.min(1, s.hunger + 0.06); g.ui.toast('🫐 甘酸っぱい'); }
        a.pickup();
        break;
      }
    }
    g.ui.refresh();
  }

  fireAction(label) {
    const g = this.g, s = g.state;
    if (label.startsWith('薪をくべる')) {
      // at fuel >= 1.15 this computed n <= 0 and "fed 0 logs" (or negative -> wood duplicated)
      const n = Math.min(s.inv.wood, Math.max(1, Math.ceil((1.15 - g.fire.fuel) / 0.2)));
      if (n <= 0) return;
      s.add('wood', -n); g.fire.addFuel(n * 0.2); s.flags.fed = true;
      g.audio.chop(); g.ui.toast(`🪵 薪を${n}本くべた`);
      g.fireLogs.visible = true;
      if (g.fire.lit) g.fire.intensity = Math.max(0, g.fire.intensity - 0.15); // briefly smothers
    } else if (label === '火をつける') this.startIgnite();
    else if (label === '魚を焼く') this.startCook('fish');
    else if (label === 'キノコを焼く') this.startCook('mushroom');
    else if (label === 'コーヒーを淹れる') this.makeCoffee();
    else this.relax();
  }

  // ---------- generic minigame panel helpers
  open(html, mode) {
    this.mg.innerHTML = html; this.mg.classList.remove('hidden');
    this.mode = mode; this.btn.classList.remove('hidden');
    this.g.player.locked = !!mode.lock;
  }
  close() {
    this.mg.classList.add('hidden'); this.mg.innerHTML = '';
    this.mode = null; this.g.player.locked = this.busy;
    this.g.viewmodel.set(null);
  }

  // ---------- chopping: timing ring
  startChop(trunk) {
    const g = this.g;
    g.viewmodel.set('axe');
    this.open(`<div class="mg-title">倒木を割る</div><div class="timing"><div class="zone"></div><div class="needle"></div></div><div class="mg-hint">針が緑に入った瞬間にタップ（${trunk.hp}回）</div>`, {
      lock: true, t: 0, dir: 1, pos: 0,
      update: (dt) => {
        const m = this.mode; m.pos += m.dir * dt * 1.25; if (m.pos > 1) { m.pos = 1; m.dir = -1; } if (m.pos < 0) { m.pos = 0; m.dir = 1; }
        const nd = this.mg.querySelector('.needle'); if (nd) nd.style.left = (m.pos * 100) + '%';
      },
      tap: () => {
        const m = this.mode;
        const hit = Math.abs(m.pos - 0.5) < 0.12;
        g.viewmodel.swing();
        g.audio.chop();
        if (hit) {
          trunk.hp--; g.shake(0.25);
          const n = 1 + (Math.abs(m.pos - 0.5) < 0.05 ? 1 : 0);
          g.state.add('wood', n); g.state.stats.woodGathered += n;
          g.ui.toast(n > 1 ? '🪵 会心の一撃！ 薪 +2' : '🪵 薪 +1');
          g.particles?.chips(trunk.pos);
        } else { g.ui.toast('空振り…'); }
        if (trunk.hp <= 0) {
          g.scene.remove(trunk.obj); g.world.colliders.remove(trunk.col);
          const ci = g.world.choppables.indexOf(trunk); if (ci >= 0) g.world.choppables.splice(ci, 1);
          g.ui.toast('倒木を割り終えた'); this.close();
        } else this.mg.querySelector('.mg-hint').textContent = `針が緑に入った瞬間にタップ（残り${trunk.hp}回）`;
        g.ui.refresh();
      },
    });
    this.label.textContent = '振る！';
  }

  // ---------- ignite: rapid taps fill spark meter, decays
  startIgnite() {
    const g = this.g;
    this.open(`<div class="mg-title">ファイヤースターター</div><div class="meter"><i></i></div><div class="mg-hint">連打して火花を散らそう！</div>`, {
      lock: true, v: 0, t: 0,
      update: (dt) => {
        const m = this.mode; m.v = Math.max(0, m.v - dt * 0.35); m.t += dt;
        if (!(g.fire.fuel > 0.05)) { g.ui.toast('薪が足りない…先に薪をくべよう'); g.fire.smoulder = 0; this.close(); return; }
        this.mg.querySelector('.meter i').style.width = (m.v * 100) + '%';
        g.fire.smoulder = m.v;
        if (m.t > 20) { g.ui.toast('火がつかなかった…もう一度'); g.fire.smoulder = 0; this.close(); }
      },
      tap: () => {
        const m = this.mode; m.v = Math.min(1, m.v + 0.085); g.audio.burst(4000 + Math.random() * 3000, 3, 0.2, 0.05);
        g.fire.sparkBurst?.();
        if (m.v >= 1) {
          // ignite() can fail (fuel burned away meanwhile) -> don't grant the quest flag for an unlit fire
          if (g.fire.ignite()) { g.audio.ignite(); g.state.flags.ignited = true; g.ui.toast('🔥 火がついた！'); }
          else g.ui.toast('薪が足りない…先に薪をくべよう');
          g.fire.smoulder = 0; this.close(); g.ui.refresh();
        }
      },
    });
    this.label.textContent = '擦る！';
  }

  // ---------- cooking: heat progress with sweet spot
  startCook(kind) {
    const g = this.g;
    const name = kind === 'fish' ? '魚' : 'キノコ';
    g.state.add(kind, -1);
    g.viewmodel.set(kind === 'fish' ? 'skewerFish' : 'skewerMush');
    this.open(`<div class="mg-title">${name}を焼く</div><div class="cook"><div class="cz raw">生</div><div class="cz good">ちょうど良い</div><div class="cz burnt">焦げ</div><div class="cneedle"></div></div><div class="mg-hint">「ちょうど良い」で火から上げよう</div>`, {
      lock: true, v: 0,
      update: (dt) => {
        const m = this.mode;
        // fire went out while cooking -> give the food back instead of cooking over nothing
        if (!g.fire.lit && g.fire.intensity < 0.05) { g.ui.toast('火が消えてしまった…'); g.state.add(kind, 1); this.close(); g.ui.refresh(); return; }
        m.v += dt * 0.1 * (0.6 + g.fire.intensity);
        this.mg.querySelector('.cneedle').style.left = Math.min(100, m.v * 100) + '%';
        g.viewmodel.cookLevel(m.v);
        if (Math.random() < dt * 3) g.audio.sizzle();
        if (m.v >= 1) m.tap();
      },
      tap: () => {
        if (!this.mode) return;
        const v = this.mode.v;
        if (v > 0.55 && v < 0.8) {
          if (kind === 'fish') { g.state.add('cooked', 1); g.ui.toast('🍢 完璧な焼き加減！'); }
          else { g.state.hunger = Math.min(1, g.state.hunger + 0.2); g.ui.toast('🍄 香ばしいキノコを食べた'); }
          g.audio.success();
        } else if (v <= 0.55) { g.ui.toast('まだ生焼けだ…もう少し'); g.state.add(kind, 1); }
        else { g.ui.toast('焦げてしまった…'); g.state.hunger = Math.min(1, g.state.hunger + 0.05); }
        this.close(); g.ui.refresh();
      },
    });
    this.label.textContent = '上げる';
  }

  // brewing/relaxing are ticked by update() (not setTimeout): they pause with the menu, and the kettle is
  // taken off the tripod afterwards (it used to stay there forever)
  makeCoffee() {
    const g = this.g;
    if (this.brewing) return;
    g.state.flags.coffeeToday = true;
    g.kettle.visible = true;
    this.brewing = 6;
    g.ui.toast('☕ ケトルを火にかけた…');
  }

  tickBrew(dt) {
    if (!this.brewing) return;
    const g = this.g;
    this.brewing -= dt;
    if (this.brewing > 0) return;
    this.brewing = 0;
    g.kettle.visible = false;
    g.audio.tone(1800, 1.4, 0.05, 'sine', 1.1);
    g.ui.toast('☕ 淹れたてのコーヒー。体が温まる');
    g.state.warmth = Math.min(1, g.state.warmth + 0.3); g.state.energy = Math.min(1, g.state.energy + 0.25);
    g.ui.refresh();
  }

  relax() {
    const g = this.g;
    g.ui.toast('焚き火を眺めてのんびり… (時間が早く進む)');
    g.fastForward = 8;
    this.relaxT = 6; // a second relax used to be cut short by the first relax's pending timer
  }

  tickRelax(dt) {
    if (!(this.relaxT > 0)) return;
    const g = this.g;
    this.relaxT -= dt;
    const pp = g.player.pos, fp = g.fire.position; // walking away ends it
    if (this.relaxT <= 0 || Math.hypot(pp.x - fp.x, pp.z - fp.z) > 4) { this.relaxT = 0; g.fastForward = 1; }
  }

  sleep() {
    const g = this.g, s = g.state;
    if (this.busy) return; // repeated taps during the fade queued several sleeps (multiple days skipped)
    this.busy = true;
    g.player.locked = true;
    g.fastForward = 1; this.relaxT = 0;
    g.audio.zipper();
    g.ui.fade(true, () => {
      const night = s.hours >= 19 || s.hours < 5; // evaluated when actually falling asleep
      if (night) {
        if (s.hours >= 19) s.day++;
        s.hours = 6.2; s.energy = 1; s.flags.slept = true; s.flags.coffeeToday = false;
        s.hunger = Math.max(0.1, s.hunger - 0.25);
        s.warmth = Math.max(s.warmth, 0.7); // warm sleeping bag
        g.fire.fuel = 0; g.fire.lit = false; g.fire.intensity = 0;
        g.ui.toast('🌅 おはよう。朝霧の湖畔で目が覚めた');
        g.fogMorning = 1;
      } else {
        s.hours += 1.5; // could exceed 24 (e.g. nap at 18:00 -> 19.5 fine, but 23+ wrapped wrong)
        if (s.hours >= 24) { s.hours -= 24; s.day++; s.flags.coffeeToday = false; }
        s.energy = Math.min(1, s.energy + 0.35); g.ui.toast('少し休んで元気が出た');
      }
      g.saveGame(); g.ui.refresh(); // state.save() alone dropped the player position & fire
      setTimeout(() => { g.ui.fade(false); this.busy = false; g.player.locked = !!this.mode?.lock; }, 900);
    });
  }

  // ---------- fishing
  startFishing() {
    const g = this.g;
    g.viewmodel.set('rod');
    const origin = g.player.pos.clone();
    const f = new THREE.Vector3();
    this.open(`<div class="mg-title">釣り</div><div class="meter cast"><i></i></div><div class="mg-hint">タップで投げる（パワーが最大のときに）</div>`, {
      lock: false, phase: 'aim', power: 0, dir: 1, t: 0, bite: 0, tension: 0.3, prog: 0.15,
      update: (dt) => {
        const m = this.mode; m.t += dt;
        const pp = g.player.pos; // walking away (player isn't locked while fishing) -> reel in
        if (Math.hypot(pp.x - origin.x, pp.z - origin.z) > 3.5) { g.ui.toast('釣りをやめた'); this.endFish(); return; }
        if (m.phase === 'aim') {
          m.power += m.dir * dt * 1.1; if (m.power > 1) { m.power = 1; m.dir = -1; } if (m.power < 0) { m.power = 0; m.dir = 1; }
          this.mg.querySelector('.meter i').style.width = (m.power * 100) + '%';
        } else if (m.phase === 'fly') {
          m.ft += dt / 0.9;
          const k = Math.min(1, m.ft);
          const start = g.viewmodel.tipWorld(this.tmpV);
          this.bobber.position.lerpVectors(start, m.target, k); this.bobber.position.y += Math.sin(k * Math.PI) * 3;
          if (k >= 1) {
            m.phase = 'wait'; m.bite = 3 + Math.random() * 9 * (g.state.hours > 5 && g.state.hours < 8 || g.state.hours > 17 && g.state.hours < 20 ? 0.5 : 1);
            g.water.addRipple(m.target.x, m.target.z, 1); g.audio.splash();
            this.mg.querySelector('.mg-hint').textContent = 'ウキが沈むのを待とう…';
          }
        } else if (m.phase === 'wait') {
          m.bite -= dt;
          this.bobber.position.y = WORLD.waterLevel + Math.sin(m.t * 2) * 0.01;
          if (m.bite < 1.2 && m.bite > 0 && Math.random() < dt * 2) { this.bobber.position.y -= 0.02; g.water.addRipple(this.bobber.position.x, this.bobber.position.z, 0.3); }
          if (m.bite <= 0) {
            m.phase = 'bite'; m.window = 1.1;
            this.bobber.position.y = WORLD.waterLevel - 0.06;
            g.water.addRipple(this.bobber.position.x, this.bobber.position.z, 1.4); g.audio.splash();
            navigator.vibrate?.(120);
            this.mg.querySelector('.mg-hint').innerHTML = '<b class="alert">今だ！ タップ！</b>';
            this.label.textContent = '合わせる！';
          }
        } else if (m.phase === 'bite') {
          m.window -= dt;
          if (m.window <= 0) { g.ui.toast('逃げられた…'); m.phase = 'wait'; m.bite = 3 + Math.random() * 7; this.label.textContent = 'やめる'; this.mg.querySelector('.mg-hint').textContent = 'ウキが沈むのを待とう…'; }
        } else if (m.phase === 'reel') {
          // fish pulls in bursts; player holds (taps) to reel; tension rises with reeling and with fish pulls
          const fish = m.fish;
          m.pull = Math.max(0, (m.pull || 0) - dt);
          if (m.pull <= 0 && Math.random() < dt * 0.9) m.pull = 0.6 + Math.random() * 1.2 * fish.power;
          const fishPull = m.pull > 0 ? 0.55 * fish.power : 0.05;
          m.tension += (fishPull * (m.reeling > 0 ? 1.4 : 0.35) - 0.28) * dt;
          if (m.reeling > 0) { m.prog += dt * 0.16 / fish.power * (m.pull > 0 ? 0.35 : 1); m.reeling -= dt; }
          else m.prog -= dt * (m.pull > 0 ? 0.07 : 0.01);
          m.tension = Math.max(0, m.tension);
          this.mg.querySelector('.tens i').style.width = Math.min(100, m.tension * 100) + '%';
          this.mg.querySelector('.tens i').style.background = m.tension > 0.82 ? '#ff4b3a' : m.tension > 0.6 ? '#ffb13a' : '#7ddc6a';
          this.mg.querySelector('.prog i').style.width = Math.max(0, Math.min(100, m.prog * 100)) + '%';
          // bobber moves toward player
          const bp = this.bobber.position;
          const tp = g.viewmodel.tipWorld(this.tmpV);
          bp.x = m.target.x + (tp.x - m.target.x) * m.prog + Math.sin(m.t * 5) * 0.4 * (m.pull > 0 ? 1 : 0.2);
          bp.z = m.target.z + (tp.z - m.target.z) * m.prog + Math.cos(m.t * 4) * 0.4 * (m.pull > 0 ? 1 : 0.2);
          bp.y = WORLD.waterLevel - 0.05;
          if (Math.random() < dt * 6) g.water.addRipple(bp.x, bp.z, 0.5);
          g.viewmodel.bend(m.tension);
          if (m.tension >= 1) { g.ui.toast('ラインが切れた！'); navigator.vibrate?.([80, 40, 80]); g.audio.burst(3000, 2, 0.3, 0.05); this.endFish(); }
          else if (m.prog <= 0) { g.ui.toast('逃げられた…'); this.endFish(); }
          else if (m.prog >= 1) this.landFish();
        }
      },
      tap: () => {
        const m = this.mode;
        if (m.phase === 'aim') {
          const dist = 6 + m.power * 16;
          // cast where the player looks NOW (direction/origin were frozen when fishing started)
          g.player.forward(f); f.y = 0;
          if (f.lengthSq() < 1e-6) f.set(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw));
          f.normalize();
          const p = g.player.pos;
          m.target = new THREE.Vector3(p.x + f.x * dist, WORLD.waterLevel, p.z + f.z * dist);
          if (heightAt(m.target.x, m.target.z) > WORLD.waterLevel - 0.3) { g.ui.toast('水面に向かって投げよう'); return; }
          m.phase = 'fly'; m.ft = 0; this.bobber.visible = true; this.line.visible = true;
          g.viewmodel.swing(); g.audio.burst(1800, 1, 0.2, 0.3, 'bandpass');
          this.mg.innerHTML = `<div class="mg-title">釣り</div><div class="mg-hint">…</div>`;
          this.label.textContent = 'やめる';
        } else if (m.phase === 'wait' || m.phase === 'fly') { this.endFish(); }
        else if (m.phase === 'bite') {
          m.phase = 'reel';
          const r = Math.random(); let acc = 0; let fish = FISH[0];
          for (const fi of FISH) { acc += fi.w; if (r < acc) { fish = fi; break; } }
          m.fish = { ...fish, size: Math.round(fish.min + Math.random() * (fish.max - fish.min)) };
          m.fish.power *= 0.8 + (m.fish.size - fish.min) / (fish.max - fish.min) * 0.5;
          this.mg.innerHTML = `<div class="mg-title">ファイト！</div><div class="lbl">テンション</div><div class="meter tens"><i></i></div><div class="lbl">距離</div><div class="meter prog"><i></i></div><div class="mg-hint">連打で巻く・テンションが赤になったら手を止める</div>`;
          this.label.textContent = '巻く！';
        } else if (m.phase === 'reel') { m.reeling = 0.22; g.audio.reelTick(); }
      },
    });
    this.label.textContent = '投げる';
  }

  updateLine() {
    if (!this.line.visible) return;
    const a = this.g.viewmodel.tipWorld(this._tipA || (this._tipA = new THREE.Vector3())), b = this.bobber.position;
    const pos = this.line.geometry.attributes.position;
    const sag = this.mode?.phase === 'reel' ? 0.05 : 0.6;
    for (let i = 0; i < pos.count; i++) {
      const t = i / (pos.count - 1);
      pos.setXYZ(i, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag, a.z + (b.z - a.z) * t);
    }
    pos.needsUpdate = true;
  }

  landFish() {
    const g = this.g, m = this.mode, fish = m.fish;
    g.state.add('fish', 1); g.state.stats.fishCaught++;
    g.state.stats.biggestFish = Math.max(g.state.stats.biggestFish, fish.size);
    g.audio.splash(true); g.audio.success(); navigator.vibrate?.(200);
    g.ui.showCatch(fish);
    this.endFish();
  }

  endFish() {
    this.bobber.visible = false; this.line.visible = false;
    this.close(); this.g.ui.refresh();
  }
}
