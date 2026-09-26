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
    const joyEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joyId) continue;
        this.joyId = null; this.move.x = this.move.y = 0; this.autoRun = false;
        knob.style.transform = 'translate(0,0)';
        base.classList.remove('active');
        base.style.left = ''; base.style.top = '';
      }
    };
    window.addEventListener('touchmove', joyMove, { passive: false });
    window.addEventListener('touchend', joyEnd); window.addEventListener('touchcancel', joyEnd);

    lookzone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.lookId !== null) return;
      const t = e.changedTouches[0];
      this.lookId = t.identifier; this.lookLast = { x: t.clientX, y: t.clientY };
      this.lookStart = { x: t.clientX, y: t.clientY, time: performance.now() };
    }, { passive: false });
    window.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
        this.lookDelta.x += (t.clientX - this.lookLast.x);
        this.lookDelta.y += (t.clientY - this.lookLast.y);
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.lookId) continue;
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
      el.addEventListener('mousedown', (e) => { e.stopPropagation(); on(); });
      el.addEventListener('mouseup', () => off?.());
    };
    hold('btnRun', () => { this.run = !this.run; document.getElementById('btnRun').classList.toggle('on', this.run); });
    hold('btnCrouch', () => { this.crouch = !this.crouch; document.getElementById('btnCrouch').classList.toggle('on', this.crouch); });
    this.onAction = null;
    hold('btnAction', () => this.onAction?.());

    // ---- dev fallback (PC): WASD + mouse drag
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'KeyE' || e.code === 'Space') this.onAction?.(); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    let md = false, lx = 0, ly = 0;
    lookzone.addEventListener('mousedown', (e) => { md = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => (md = false));
    window.addEventListener('mousemove', (e) => { if (!md) return; this.lookDelta.x += e.clientX - lx; this.lookDelta.y += e.clientY - ly; lx = e.clientX; ly = e.clientY; });
  }

  consumeLook() {
    const k = 0.0042 * this.sens;
    const d = { x: this.lookDelta.x * k, y: this.lookDelta.y * k };
    this.lookDelta.x = this.lookDelta.y = 0;
    return d;
  }

  getMove() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.has('KeyW')) y += 1; if (this.keys.has('KeyS')) y -= 1;
    if (this.keys.has('KeyA')) x -= 1; if (this.keys.has('KeyD')) x += 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y, run: this.run || this.autoRun || this.keys.has('ShiftLeft') };
  }
}
