// Fully procedural spatial audio (WebAudio): wind, lake lapping, fire crackle, birds by day,
// crickets/owls by night, footsteps by surface, UI sounds, chopping, splash.
export class AudioEngine {
  constructor() {
    this.ctx = null; this.enabled = false; this.volume = 0.8;
    this.night = 0; this.fireLevel = 0; this.fireDist = 100; this.waterDist = 100; this.rain = 0;
    this.birdT = 2; this.owlT = 20; this.crackT = 0;
    // layered ambience timers (Lane D)
    this.gustT = 6; this.gust = 0; this.lapT = 1; this.frogT = 4; this.peckT = 25; this.uguT = 12; this.dripT = 0;
    this.thunderT = 40; this.creakT = 30; this.popT = 3; this.hissT = 5;
    this.onCall = null; // (kind) => void — FieldGuide.heard(kind) listens to animal calls
  }

  init() {
    if (this.ctx) { this.ctx.resume?.().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // no WebAudio -> play silently instead of throwing on start
    let ctx;
    try { ctx = new AC(); } catch { return; }
    this.ctx = ctx;
    ctx.resume?.().catch(() => {});
    // autoplay policy: a context created outside a user gesture (autostart, iOS) stays suspended.
    // Resume on the next gesture; update()/burst() skip work while suspended so nothing piles up.
    const unlock = () => {
      if (ctx.state === 'running') { for (const ev of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(ev, unlock, true); return; }
      ctx.resume?.().catch(() => {});
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, unlock, true);
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    // reverb (forest)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb).connect(this.master);

    this.noiseBuf = this.makeNoise(4, 'pink');
    this.brownBuf = this.makeNoise(4, 'brown');

    // wind bed
    this.wind = this.loopNoise(this.noiseBuf, 'bandpass', 420, 0.5);
    this.wind2 = this.loopNoise(this.brownBuf, 'lowpass', 260, 0.7);
    // water lapping
    this.water = this.loopNoise(this.noiseBuf, 'bandpass', 900, 1.2);
    // fire roar bed
    this.fireBed = this.loopNoise(this.brownBuf, 'lowpass', 500, 0.8);
    // crickets
    this.crickets = this.makeCrickets();
    // rain
    this.rainBed = this.loopNoise(this.noiseBuf, 'highpass', 1400, 0.4);
    // leaves rustling in the canopy (swells with every gust), a low lake "breath", fire bed gets a panner
    this.leaves = this.loopNoise(this.noiseBuf, 'highpass', 2600, 0.5);
    this.lakeLow = this.loopNoise(this.brownBuf, 'lowpass', 180, 0.6);
    this.firePan = ctx.createStereoPanner();
    this.fireBed.g.disconnect(); this.fireBed.g.connect(this.firePan).connect(this.master);
    this.enabled = true;
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0.8));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02); // no click
  }

  makeNoise(sec, type) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < n; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
        } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    return b;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec, b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }

  loopNoise(buf, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * 3);
    // slowly wandering playback rate: a fixed-rate 4 s noise loop is audible as a repeating "whoosh" pattern
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.03 + Math.random() * 0.05;
    const lg = ctx.createGain(); lg.gain.value = 0.06; lfo.connect(lg).connect(src.playbackRate); lfo.start();
    return { src, f, g };
  }

  makeCrickets() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master); g.connect(this.revSend);
    const voices = [];
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 4200 + i * 330 + Math.random() * 200;
      const am = ctx.createOscillator(); am.frequency.value = 28 + Math.random() * 16;
      const amg = ctx.createGain(); amg.gain.value = 0.5;
      const vg = ctx.createGain(); vg.gain.value = 0.5;
      const chirp = ctx.createOscillator(); chirp.type = 'square'; chirp.frequency.value = 1.2 + Math.random() * 1.8;
      const chg = ctx.createGain(); chg.gain.value = 0.5;
      am.connect(amg.gain); chirp.connect(chg).connect(vg.gain);
      const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
      osc.connect(amg).connect(vg).connect(pan).connect(g);
      osc.start(); am.start(); chirp.start();
      voices.push(osc);
    }
    return { g };
  }

  env(g, t, a, peak, d) {
    // exponentialRampToValueAtTime throws RangeError for 0 / negative / non-finite values
    // (e.g. fire crackle at fv=0 or volume-scaled peaks) -> that exception broke the whole frame loop
    peak = Number.isFinite(peak) ? Math.max(peak, 0.0002) : 0.0002;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  burst(freq, q, peak, dur, type = 'bandpass', pan = 0, rev = 0.2, buf) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (ctx.state !== 'running') return; // don't pile up nodes while suspended (tab hidden)
    const s = ctx.createBufferSource(); s.buffer = buf || this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.master);
    if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg).connect(this.revSend); }
    this.env(g, t, 0.004, peak, dur);
    s.start(t, Math.random() * Math.max(0, s.buffer.duration - dur - 0.2), dur + 0.1);
    s.onended = () => s.disconnect(); // release the node graph
  }

  tone(freq, dur, peak = 0.2, type = 'sine', slide = 0, pan = 0, rev = 0.3) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (ctx.state !== 'running') return;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg).connect(this.revSend); }
    this.env(g, t, 0.01, peak, dur);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => o.disconnect();
  }

  footstep(surface = 'grass', run = false) {
    const v = run ? 1.3 : 1;
    if (surface === 'wood') { this.burst(260, 2, 0.35 * v, 0.09, 'bandpass', 0, 0.1); this.tone(110, 0.08, 0.12 * v, 'triangle'); }
    else if (surface === 'sand') this.burst(2400, 0.7, 0.12 * v, 0.14, 'bandpass');
    else if (surface === 'water') { this.burst(1400, 0.8, 0.2 * v, 0.2, 'bandpass'); this.burst(600, 1.2, 0.12, 0.25); }
    else if (surface === 'dirt') this.burst(900, 0.9, 0.16 * v, 0.1, 'bandpass');
    else { this.burst(3200, 0.6, 0.1 * v, 0.12, 'bandpass'); this.burst(700, 1, 0.07 * v, 0.07); }
  }

  chop() { this.burst(420, 3, 0.8, 0.12, 'bandpass', 0, 0.5); this.tone(180, 0.12, 0.25, 'triangle', 0.6); }
  pickup() { this.tone(660, 0.12, 0.12, 'sine', 1.5, 0, 0.3); setTimeout(() => this.tone(990, 0.18, 0.1, 'sine', 1.2, 0, 0.3), 70); }
  success() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 0.1, 'triangle', 1, 0, 0.5), i * 90)); }
  splash(big = false) { this.burst(1100, 0.6, big ? 0.6 : 0.3, big ? 0.6 : 0.3, 'bandpass', 0, 0.4); this.burst(300, 0.8, big ? 0.4 : 0.15, 0.4, 'lowpass'); }
  sizzle() { this.burst(5000, 0.5, 0.15, 1.2, 'highpass'); }
  click() { this.tone(1200, 0.04, 0.06, 'square', 0.5, 0, 0); }
  zipper() { for (let i = 0; i < 10; i++) setTimeout(() => this.burst(3000 + i * 150, 4, 0.12, 0.03), i * 28); }
  reelTick() { this.burst(4200, 8, 0.08, 0.02, 'bandpass', 0, 0); }
  ignite() { this.burst(800, 0.5, 0.5, 0.9, 'lowpass', 0, 0.4, this.brownBuf); this.sizzle(); }

  bird() {
    // procedural songbird phrase
    const base = 2200 + Math.random() * 1800, n = 3 + ((Math.random() * 5) | 0), pan = Math.random() * 2 - 1;
    for (let i = 0; i < n; i++) setTimeout(() => this.tone(base * (0.8 + Math.random() * 0.5), 0.07 + Math.random() * 0.08, 0.04, 'sine', 0.7 + Math.random() * 0.8, pan, 0.6), i * (90 + Math.random() * 60));
  }
  called(kind) { try { this.onCall?.(kind); } catch { /* listener errors must not break audio */ } }

  owl() {
    this.called('owl');
    const pan = Math.random() * 2 - 1;
    this.tone(380, 0.35, 0.07, 'sine', 0.92, pan, 0.8);
    setTimeout(() => this.tone(360, 0.6, 0.08, 'sine', 0.9, pan, 0.8), 450);
  }
  loon() { this.called('loon'); const pan = Math.random() * 2 - 1; this.tone(620, 1.4, 0.05, 'sine', 1.35, pan, 0.9); setTimeout(() => this.tone(840, 1.2, 0.04, 'sine', 0.8, pan, 0.9), 1400); }

  // tremolo'd sine with an FM wobble: much closer to a real bird whistle than a plain tone
  whistle(f0, f1, dur, peak, pan, delay = 0, vib = 0) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    let v;
    if (vib) { v = ctx.createOscillator(); v.frequency.value = vib; const vg = ctx.createGain(); vg.gain.value = f0 * 0.04; v.connect(vg).connect(o.frequency); v.start(t); v.stop(t + dur + 0.05); }
    const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(0.06, dur * 0.3));
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const rg = ctx.createGain(); rg.gain.value = 0.7;
    o.connect(g).connect(p).connect(this.master); p.connect(rg).connect(this.revSend);
    o.start(t); o.stop(t + dur + 0.05);
    o.onended = () => { o.disconnect(); v?.disconnect(); p.disconnect(); };
  }

  // ウグイス: long rising "ホーー" then a fast "ホケキョ"
  uguisu() {
    this.called('uguisu');
    const pan = Math.random() * 1.6 - 0.8, k = 0.9 + Math.random() * 0.2;
    this.whistle(900 * k, 1150 * k, 1.1, 0.035, pan);
    this.whistle(1900 * k, 1500 * k, 0.12, 0.04, pan, 1.35);
    this.whistle(1600 * k, 1450 * k, 0.1, 0.035, pan, 1.52);
    this.whistle(2500 * k, 2100 * k, 0.28, 0.045, pan, 1.68, 30);
  }

  // アカゲラ drumming: ~15 knocks at ~17 Hz on a hollow trunk, slightly decelerating
  woodpecker() {
    this.called('woodpecker');
    const pan = Math.random() * 2 - 1, f = 700 + Math.random() * 500, n = 12 + ((Math.random() * 8) | 0);
    let d = 0;
    for (let i = 0; i < n; i++) {
      const di = d; setTimeout(() => this.burst(f, 6, 0.09 * (1 - i / n * 0.5), 0.018, 'bandpass', pan, 0.6), di * 1000);
      d += 0.055 + i * 0.0015;
    }
  }

  // frog: pulse-train croak (AM'd sawtooth through a formant bandpass)
  frog(pan = Math.random() * 2 - 1) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.18 + Math.random() * 0.25;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180 + Math.random() * 160;
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 22 + Math.random() * 18;
    const amg = ctx.createGain(); amg.gain.value = 0.5;
    const vca = ctx.createGain(); vca.gain.value = 0.5; am.connect(amg).connect(vca.gain);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 500; f.Q.value = 4;
    const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(vca).connect(f).connect(g).connect(p).connect(this.master);
    const rg = ctx.createGain(); rg.gain.value = 0.4; p.connect(rg).connect(this.revSend);
    this.env(g, t, 0.02, 0.05, dur);
    o.start(t); am.start(t); o.stop(t + dur + 0.1); am.stop(t + dur + 0.1);
    o.onended = () => { o.disconnect(); am.disconnect(); p.disconnect(); };
  }

  // tree creak on strong gusts
  creak() {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.8 + Math.random() * 1.2;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 60; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 400; bp.Q.value = 6;
    const g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = Math.random() * 2 - 1;
    o.connect(bp).connect(g).connect(p).connect(this.master);
    const rg = ctx.createGain(); rg.gain.value = 0.8; p.connect(rg).connect(this.revSend);
    this.env(g, t, dur * 0.4, 0.018, dur * 0.6);
    o.start(t); o.stop(t + dur + 0.1); o.onended = () => { o.disconnect(); p.disconnect(); };
  }

  thunder() { this.burst(90, 0.7, 0.5, 3.5, 'lowpass', Math.random() - 0.5, 0.9, this.brownBuf); setTimeout(() => this.burst(160, 0.8, 0.25, 2.2, 'lowpass', 0, 0.9, this.brownBuf), 300); }

  update(dt, s) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    if (this.extra) s = Object.assign(s, this.extra); // (s is a fresh literal from main.js each frame) hours / dusk / firePan from src/fx/laned.js
    const t = this.ctx.currentTime, k = 0.25;
    const windAmt = 0.05 + 0.04 * Math.sin(t * 0.13) + 0.03 * Math.sin(t * 0.41);
    this.wind.g.gain.setTargetAtTime(windAmt * (1 + s.rain), t, k);
    this.wind.f.frequency.setTargetAtTime(380 + 180 * Math.sin(t * 0.21), t, 1);
    this.wind2.g.gain.setTargetAtTime(0.06, t, k);
    const wv = Math.max(0, 1 - s.waterDist / 40);
    this.water.g.gain.setTargetAtTime(wv * wv * (0.09 + 0.05 * Math.sin(t * 0.9)), t, k);
    const fv = s.fireLevel * Math.max(0, 1 - s.fireDist / 22);
    this.fireBed.g.gain.setTargetAtTime(fv * 0.22, t, k);
    this.crickets.g.gain.setTargetAtTime(s.night * 0.012 * (1 - s.rain * 0.85), t, 1); // crickets go quiet in the rain
    this.rainBed.g.gain.setTargetAtTime(s.rain * 0.18, t, 1);
    // fire crackles
    this.crackT -= dt;
    if (fv > 0.02 && this.crackT <= 0) {
      this.crackT = 0.03 + Math.random() * 0.25 / (0.3 + s.fireLevel);
      this.burst(1500 + Math.random() * 4000, 2 + Math.random() * 6, (0.08 + Math.random() * 0.3) * fv, 0.015 + Math.random() * 0.04, 'bandpass', (Math.random() - 0.5) * 0.4, 0.15);
      if (Math.random() < 0.08) this.burst(300, 1, 0.35 * fv, 0.12, 'bandpass', 0, 0.3);
    }
    // birds by day, owls & loons by night
    this.birdT -= dt;
    if (this.birdT <= 0) { this.birdT = 2 + Math.random() * 7; if (s.night < 0.4 && s.rain < 0.5) this.bird(); }
    this.owlT -= dt;
    if (this.owlT <= 0) { this.owlT = 18 + Math.random() * 30; if (s.night > 0.6 && s.rain < 0.5) (Math.random() < 0.6 ? this.owl() : this.loon()); }

    // ---- layered ambience (Lane D)
    const hours = Number.isFinite(s.hours) ? s.hours : 12;
    // wind gusts: slow random swells drive the canopy rustle, the wind bed and the odd tree creak
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 6 + Math.random() * 14; this.gustTarget = 0.4 + Math.random() * 0.6 + s.rain * 0.4; }
    this.gustTarget = Math.max(0, (this.gustTarget || 0) - dt * 0.12);
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.8);
    const forest = Math.min(1, Math.max(0.25, (s.waterDist - 4) / 30)); // canopy is thin over the open lake
    this.leaves.g.gain.setTargetAtTime((0.006 + this.gust * 0.035) * forest, t, 0.6);
    this.leaves.f.frequency.setTargetAtTime(2200 + this.gust * 1600, t, 0.8);
    this.wind2.g.gain.setTargetAtTime(0.05 + this.gust * 0.05, t, 0.8);
    this.creakT -= dt;
    if (this.creakT <= 0) { this.creakT = 20 + Math.random() * 40; if (this.gust > 0.45 && forest > 0.5) this.creak(); }
    // lake: low body + discrete laps against the shore / dock
    this.lakeLow.g.gain.setTargetAtTime(wv * wv * 0.08, t, 0.8);
    this.lapT -= dt;
    if (wv > 0.3 && this.lapT <= 0) {
      this.lapT = 0.35 + Math.random() * 1.4;
      this.burst(350 + Math.random() * 500, 1.2, (0.05 + Math.random() * 0.07) * wv * wv, 0.12 + Math.random() * 0.2, 'lowpass', (Math.random() - 0.5) * 0.8, 0.25);
    }
    // frogs chorus from the shore from dusk to night (quiet in the rain's roar, loud right after rain)
    this.frogT -= dt;
    const frogAmt = Math.max(0, 1 - s.waterDist / 45) * Math.min(1, s.night * 1.4 + (s.dusk || 0) * 0.5);
    if (this.frogT <= 0) {
      this.frogT = 0.4 + Math.random() * 2.5 / (0.2 + frogAmt);
      if (frogAmt > 0.15 && Math.random() < frogAmt) { const pan = Math.random() * 2 - 1; this.frog(pan); if (Math.random() < 0.4) setTimeout(() => this.frog(pan), 250 + Math.random() * 200); }
    }
    // day birds: woodpecker drumming in the forest, ウグイス in the morning
    this.peckT -= dt;
    if (this.peckT <= 0) { this.peckT = 25 + Math.random() * 45; if (s.night < 0.3 && s.rain < 0.3 && forest > 0.4) this.woodpecker(); }
    this.uguT -= dt;
    if (this.uguT <= 0) { this.uguT = 14 + Math.random() * 26; if (hours > 4.8 && hours < 11 && s.night < 0.3 && s.rain < 0.4) this.uguisu(); }
    // rain: drips from the canopy + distant thunder when it pours
    if (s.rain > 0.05) {
      this.dripT -= dt;
      while (this.dripT <= 0) { this.dripT += 0.02 + Math.random() * 0.25 / s.rain; this.burst(2500 + Math.random() * 4500, 5, 0.015 + Math.random() * 0.04 * s.rain, 0.012, 'bandpass', Math.random() * 2 - 1, 0.2); }
      this.thunderT -= dt;
      if (this.thunderT <= 0) { this.thunderT = 35 + Math.random() * 60; if (s.rain > 0.7) this.thunder(); }
    }
    // fire: stereo position relative to the listener, hiss of moisture, occasional log-settling thump
    // s.firePan: -1 (fire on the left) .. 1 (right); collapses to centre when standing right at the fire
    if (Number.isFinite(s.firePan)) this.firePan.pan.setTargetAtTime(Math.max(-0.85, Math.min(0.85, s.firePan)) * Math.min(1, s.fireDist / 3), t, 0.1);
    this.fireBed.f.frequency.setTargetAtTime(380 + 260 * s.fireLevel + 80 * Math.sin(t * 1.7), t, 0.2);
    if (fv > 0.05) {
      this.hissT -= dt;
      if (this.hissT <= 0) { this.hissT = 2 + Math.random() * 6; this.burst(6000 + Math.random() * 3000, 0.8, 0.03 * fv, 0.5 + Math.random() * 0.8, 'highpass', 0, 0.1); }
      this.popT -= dt;
      if (this.popT <= 0) { this.popT = 8 + Math.random() * 20; this.burst(140, 1.2, 0.35 * fv, 0.18, 'lowpass', 0, 0.4, this.brownBuf); }
    }
  }
}
