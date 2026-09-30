// Touch-first input: left virtual joystick (floating), right-side drag to look, buttons.
// Keyboard/mouse fallback exists only for development on PC.
export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.lookDelta = { x: 0, y: 0 };
    this.run = false; this.crouch = false;
    this.sens = 1.2;
    this.keys = new Set();
    this.joyId = null; this.lookId = null;
    this.onTap = null;
    this.onZoom = null;       // (factor) multiplicative zoom request (pinch / wheel / keys)
    this.onZoomStep = null;   // (+1 / -1) preset step
    this.lookScale = 1;       // set by the game from the lens (tele = slower look)
    this.pinchId = null; this.pinchD = 0;
    this.enabled = true;

    const joyzone = document.getElementById('joyzone');
    const base = document.getElementById('joybase');
    const knob = document.getElementById('joyknob');
    const lookzone = document.getElementById('lookzone');
    this.base = base; this.knob = knob;
    const R = () => base.offsetWidth * 0.5;

    joyzone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.joyId !== null) return;
      const t = e.changedTouches[0];
      this.joyId = t.identifier;
      const rect = joyzone.getBoundingClientRect();
      this.joyOrigin = { x: t.clientX, y: t.clientY };
      base.style.left = (t.clientX - rect.left) + 'px';
      base.style.top = (t.clientY - rect.top) + 'px';
      base.classList.add('active');
    }, { passive: false });
    const joyMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joyId) continue;
        let dx = t.clientX - this.joyOrigin.x, dy = t.clientY - this.joyOrigin.y;
        const r = R(), d = Math.hypot(dx, dy);
        if (d > r) { dx *= r / d; dy *= r / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.move.x = dx / r; this.move.y = -dy / r;
        // auto-run when pushed to the edge
        this.autoRun = d > r * 1.35;
      }
    };
    this.resetJoy = () => {
      this.joyId = null; this.move.x = this.move.y = 0; this.autoRun = false;
      knob.style.transform = 'translate(0,0)';
      base.classList.remove('active');
      base.style.left = ''; base.style.top = '';
    };
    const joyEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joyId) this.resetJoy();
    };
    window.addEventListener('touchmove', joyMove, { passive: false });
    window.addEventListener('touchend', joyEnd); window.addEventListener('touchcancel', joyEnd);

    const touchById = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };
    lookzone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.lookId !== null) {
        // second finger in the look zone = pinch zoom (the first finger stops looking while pinching)
        if (this.pinchId === null) {
          const t = e.changedTouches[0], a = touchById(e.touches, this.lookId);
          if (a && t.identifier !== this.lookId) { this.pinchId = t.identifier; this.pinchD = Math.hypot(t.clientX - a.clientX, t.clientY - a.clientY); this.lookStart = null; }
        }
        return;
      }
      const t = e.changedTouches[0];
      this.lookId = t.identifier; this.lookLast = { x: t.clientX, y: t.clientY };
      this.lookStart = { x: t.clientX, y: t.clientY, time: performance.now() };
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      if (this.pinchId !== null) {
        const a = touchById(e.touches, this.lookId), b = touchById(e.touches, this.pinchId);
        if (a && b) {
          const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          if (this.pinchD > 8 && d > 8) this.onZoom?.(d / this.pinchD);
          this.pinchD = d; this.lookLast = { x: a.clientX, y: a.clientY };
        }
        return;
      }
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        this.lookDelta.x += (t.clientX - this.lookLast.x);
        this.lookDelta.y += (t.clientY - this.lookLast.y);
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.pinchId) { this.pinchId = null; continue; }
        if (t.identifier !== this.lookId) continue;
        if (this.pinchId !== null) {
          // the first finger lifted while pinching: the remaining finger continues as the look finger
          const b = touchById(e.touches, this.pinchId);
          this.lookId = b ? this.pinchId : null; this.pinchId = null; this.lookStart = null;
          if (b) this.lookLast = { x: b.clientX, y: b.clientY };
          continue;
        }
        this.lookId = null;
        const s = this.lookStart;
        if (s && performance.now() - s.time < 250 && Math.hypot(t.clientX - s.x, t.clientY - s.y) < 12) this.onTap?.(t.clientX, t.clientY);
      }
    };
    window.addEventListener('touchend', lookEnd); window.addEventListener('touchcancel', lookEnd);

    // buttons
    const hold = (id, on, off) => {
      const el = document.getElementById(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); on(); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); off?.(); }, { passive: false });
      el.addEventListener('touchcancel', () => off?.());
      // primary button only (right/middle click also triggered actions)
      el.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.stopPropagation(); on(); });
      el.addEventListener('mouseup', (e) => { if (e.button === 0) off?.(); });
    };
    hold('btnRun', () => { this.run = !this.run; document.getElementById('btnRun').classList.toggle('on', this.run); });
    hold('btnCrouch', () => { this.crouch = !this.crouch; document.getElementById('btnCrouch').classList.toggle('on', this.crouch); });
    this.onAction = null;
    hold('btnAction', () => this.onAction?.());

    // ---- dev fallback (PC): WASD + mouse drag
    const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || '');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return; // arrow keys on the menu sliders moved the player
      this.keys.add(e.code);
      // key auto-repeat fired the action ~30x/s (instantly finishing minigames / chaining actions)
      if ((e.code === 'KeyE' || e.code === 'Space') && !e.repeat) { e.preventDefault(); this.onAction?.(); }
      // zoom: = / - step through presets (0.5 1 2 5 10 20 40), Z / X hold for continuous zoom
      if ((e.code === 'Equal' || e.code === 'NumpadAdd') && !e.repeat) this.onZoomStep?.(1);
      if ((e.code === 'Minus' || e.code === 'NumpadSubtract') && !e.repeat) this.onZoomStep?.(-1);
    });
    window.addEventListener('wheel', (e) => {
      if (typing(e) || e.target?.closest?.('#menu, .panel, #fieldguide')) return;
      e.preventDefault();
      // trackpads send many small deltas, mice ~100 per notch: exponential mapping handles both
      this.onZoom?.(Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0022));
    }, { passive: false });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // keys released while unfocused never fire keyup -> the player kept walking forever
    window.addEventListener('blur', () => this.reset());
    let lx = 0, ly = 0;
    this.md = false;
    let mdStart = null;
    lookzone.addEventListener('mousedown', (e) => { if (e.button !== 0) return; this.md = true; lx = e.clientX; ly = e.clientY; mdStart = { x: lx, y: ly, t: performance.now() }; });
    window.addEventListener('mouseup', (e) => {
      // short click without drag = tap (mouse had no tap at all, only touch did)
      if (this.md && mdStart && e.button === 0 && performance.now() - mdStart.t < 250 && Math.hypot(e.clientX - mdStart.x, e.clientY - mdStart.y) < 6) this.onTap?.(e.clientX, e.clientY);
      this.md = false; mdStart = null;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.md) return;
      if (!(e.buttons & 1)) { this.md = false; return; } // released outside the window
      this.lookDelta.x += e.clientX - lx; this.lookDelta.y += e.clientY - ly; lx = e.clientX; ly = e.clientY;
    });
  }

  // clear all transient input (menu, photo mode, tab hidden, game start)
  reset() {
    this.keys.clear();
    this.resetJoy();
    this.lookId = null; this.pinchId = null; this.lookDelta.x = this.lookDelta.y = 0;
    this.md = false;
  }

  consumeLook() {
    const k = 0.0042 * this.sens * this.lookScale;
    const d = this._look || (this._look = { x: 0, y: 0 });
    d.x = this.lookDelta.x * k; d.y = this.lookDelta.y * k;
    this.lookDelta.x = this.lookDelta.y = 0;
    return d;
  }

  // held Z / X = continuous zoom in / out (called once per frame)
  keyZoom(dt) {
    const z = (this.keys.has('KeyZ') ? 1 : 0) - (this.keys.has('KeyX') ? 1 : 0);
    if (z) this.onZoom?.(Math.exp(z * dt * 1.6));
  }

  getMove() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    const m = this._mv || (this._mv = { x: 0, y: 0, run: false });
    m.x = x; m.y = y; m.run = this.run || this.autoRun || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    return m;
  }
}
