// Fully procedural spatial audio (WebAudio): wind, lake lapping, fire crackle, birds by day,
// crickets/owls by night, footsteps by surface, UI sounds, chopping, splash.
export class AudioEngine {
  constructor() {
    this.ctx = null; this.enabled = false; this.volume = 0.8;
    this.night = 0; this.fireLevel = 0; this.fireDist = 100; this.waterDist = 100; this.rain = 0;
    this.birdT = 2; this.owlT = 20; this.crackT = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
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
    this.enabled = true;
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

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
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  burst(freq, q, peak, dur, type = 'bandpass', pan = 0, rev = 0.2, buf) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = buf || this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(this.master);
    if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg).connect(this.revSend); }
    this.env(g, t, 0.004, peak, dur);
    s.start(t, Math.random() * 3, dur + 0.1);
  }

  tone(freq, dur, peak = 0.2, type = 'sine', slide = 0, pan = 0, rev = 0.3) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master);
    if (rev) { const rg = ctx.createGain(); rg.gain.value = rev; p.connect(rg).connect(this.revSend); }
    this.env(g, t, 0.01, peak, dur);
    o.start(t); o.stop(t + dur + 0.05);
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
  owl() {
    const pan = Math.random() * 2 - 1;
    this.tone(380, 0.35, 0.07, 'sine', 0.92, pan, 0.8);
    setTimeout(() => this.tone(360, 0.6, 0.08, 'sine', 0.9, pan, 0.8), 450);
  }
  loon() { const pan = Math.random() * 2 - 1; this.tone(620, 1.4, 0.05, 'sine', 1.35, pan, 0.9); setTimeout(() => this.tone(840, 1.2, 0.04, 'sine', 0.8, pan, 0.9), 1400); }

  update(dt, s) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime, k = 0.25;
    const windAmt = 0.05 + 0.04 * Math.sin(t * 0.13) + 0.03 * Math.sin(t * 0.41);
    this.wind.g.gain.setTargetAtTime(windAmt * (1 + s.rain), t, k);
    this.wind.f.frequency.setTargetAtTime(380 + 180 * Math.sin(t * 0.21), t, 1);
    this.wind2.g.gain.setTargetAtTime(0.06, t, k);
    const wv = Math.max(0, 1 - s.waterDist / 40);
    this.water.g.gain.setTargetAtTime(wv * wv * (0.09 + 0.05 * Math.sin(t * 0.9)), t, k);
    const fv = s.fireLevel * Math.max(0, 1 - s.fireDist / 22);
    this.fireBed.g.gain.setTargetAtTime(fv * 0.22, t, k);
    this.crickets.g.gain.setTargetAtTime(s.night * 0.012, t, 1);
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
    if (this.owlT <= 0) { this.owlT = 18 + Math.random() * 30; if (s.night > 0.6) (Math.random() < 0.6 ? this.owl() : this.loon()); }
  }
}
