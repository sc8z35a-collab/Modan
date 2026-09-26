import * as THREE from 'three';
import { Renderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { Sky } from './world/sky.js';
import { World, loadAssets } from './world/world.js';
import { Water } from './world/water.js';
import { Grass } from './world/grass.js';
import { WORLD, heightAt } from './world/heightfield.js';
import { PATH_PTS } from './world/terrain.js';
import * as P from './world/props.js';
import { Campfire, Fireflies } from './fx/fire.js';
import { Particles } from './fx/particles.js';
import { AudioEngine } from './audio/audio.js';
import { Player } from './game/player.js';
import { GameState } from './game/state.js';
import { Interactions } from './game/interactions.js';
import { ViewModel } from './game/viewmodel.js';
import { UI } from './ui/ui.js';
import { clamp, lerp, smoothstep } from './core/noise.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

class Game {
  async init() {
    const setLoad = (p, txt) => { if (params.has('autostart')) console.log('[load]', p.toFixed(2), txt || '', performance.memory ? (performance.memory.usedJSHeapSize/1e6).toFixed(0)+'MB' : ''); $('loadbar').style.width = Math.round(p * 100) + '%'; if (txt) $('loadtxt').textContent = txt; };
    const savedQ = localStorage.getItem('modan-quality') || params.get('q') || 'ultra';
    $('optQuality').value = savedQ;
    this.R = new Renderer($('gl'), savedQ);
    this.scene = this.R.scene; this.camera = this.R.camera;
    this.state = new GameState();
    this.audio = new AudioEngine();

    setLoad(0.02, 'アセットを読み込み中…');
    this.assets = await loadAssets(this.R.r, (p) => setLoad(0.05 + p * 0.55), this.R.q.texMax || 0);
    const tick = () => new Promise((r) => setTimeout(r, 16));

    this.sky = new Sky(this.R.r, this.scene);
    this.sky.setShadowMapSize(this.R.q.shadow);
    this.world = new World(this.R.r, this.scene, this.assets, this.R.q);
    await tick();
    this.world.build((t) => setLoad(0.65, t));
    await tick();
    setLoad(0.75, '草原を生成中…');
    this.grass = new Grass(this.scene, this.world.worldData, this.world.noiseTex, this.R.q.grass);
    this.water = new Water(this.R.r, this.scene, this.camera, this.world.worldData, this.R.q.water);
    await tick();
    setLoad(0.82, 'キャンプを設営中…');
    this.buildCamp();
    this.world.buildInteractables(this.assets.models, this.assets.textures);
    this.particles = new Particles(this.scene);
    this.fireflies = new Fireflies(this.scene, new THREE.Vector3(WORLD.camp.x - 5, 0, WORLD.camp.z - 30), 260, 55);
    this.fireflies.setGround(heightAt);

    this.input = new Input();
    this.player = new Player(this.camera, this.world.colliders, this.audio, (x, z, w) => this.surfaceAt(x, z, w), this.platforms);
    this.viewmodel = new ViewModel(this.camera, this.assets.textures);
    this.ui = new UI(this);
    this.interact = new Interactions(this);
    this.input.onAction = () => { this.audio.click(); this.interact.act(); };
    this.input.onTap = () => { if (this.photo) this.togglePhoto(false); };

    this.R.buildComposer();
    this.water.resize(window.innerWidth * this.R.r.getPixelRatio(), window.innerHeight * this.R.r.getPixelRatio());
    window.addEventListener('resize', () => this.water.resize(window.innerWidth * this.R.r.getPixelRatio(), window.innerHeight * this.R.r.getPixelRatio()));

    setLoad(0.92, 'シェーダーを準備中…');
    // warm-up: compile all materials & render a few frames
    this.sky.update(this.state.hours, 0.016, this.player.pos);
    this.player.update(0, this.input);
    this.R.r.compile(this.scene, this.camera);
    if (!params.has('snap')) for (let i = 0; i < 2; i++) this.frame(1 / 60, true);
    setLoad(1, '準備完了');
    this.setupMenus();
    this.last = performance.now();
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this.started = false;
    this.titleCam = 0;
    requestAnimationFrame((t) => this.loop(t));
    await new Promise((r) => setTimeout(r, 300));
    $('loading').classList.add('hidden');
    $('title').classList.remove('hidden');
    if (GameState.hasSave()) $('btnContinue').classList.remove('hidden');
    window.__game = this;
    if (params.has('autostart')) this.start(false);
    if (params.has('snap')) this.runSnapshots();
  }

  // QA: render scripted shots and POST them to the QA server (tools/qa-server.mjs)
  async runSnapshots() {
    const shots = (params.get('snap') || 'default').split(';').map((spec) => {
      const [name, hours, pos, extra] = spec.split('|');
      return { name, hours: hours ? +hours : null, pos: pos ? pos.split(',').map(Number) : null, extra: extra || '' };
    });
    const sw = +(params.get('snapw') || 0);
    if (sw) { this.R.q.pixelRatio = 1; this.R.r.setPixelRatio(1); this.R.r.setSize(sw, Math.round(sw * 0.45), false); this.R.composer.setSize(sw, Math.round(sw * 0.45), false); this.R.camera.aspect = 1 / 0.45; this.R.camera.updateProjectionMatrix(); }
    for (const sh of shots) {
      console.log('[snap] start', sh.name, performance.now() | 0);
      if (sh.hours !== null) this.state.hours = sh.hours;
      if (sh.pos) { const [x, z, yaw, pitch] = sh.pos; this.player.pos.set(x, 0, z); this.player.yaw = yaw; this.player.pitch = pitch || 0; }
      if (sh.extra.includes('fire')) { this.fire.addFuel(1); this.fire.ignite(); this.fire.intensity = 1; this.fireLogs.visible = true; }
      if (sh.extra.includes('rain')) this.rain = 1;
      this.state.timeScale = 0; this.sky.envTimer = 99; this.snapping = true;
      const nf = +(params.get('snapf') || 2); for (let k = 0; k < nf; k++) { this.frame(1 / 30); console.log('[snap] frame', k, performance.now() | 0); await new Promise((r) => setTimeout(r, 0)); }
      const png = this.R.r.domElement.toDataURL('image/jpeg', 0.85);
      const i = this.R.r.info;
      await fetch('/__snap', { method: 'POST', body: JSON.stringify({ name: sh.name, png, info: { fps: $('fps').textContent, tris: i.render.triangles, calls: i.render.calls, trees: this.world.treeCount, ua: navigator.userAgent, gpu: this.gpuName() } }) }).catch(() => {});
    }
    document.title = 'SNAP DONE'; this.snapping = false;
  }

  gpuName() {
    const gl = this.R.r.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }

  buildCamp() {
    const C = WORLD.camp, tx = this.assets.textures, U = this.world.U;
    const put = (obj, x, z, ry = 0, yo = 0) => { obj.position.set(x, heightAt(x, z) + yo, z); obj.rotation.y = ry; this.scene.add(obj); return obj; };
    // fire
    const fx = C.x, fz = C.z;
    this.fireRing = put(P.buildFireRing(tx), fx, fz);
    this.fireLogs = put(P.buildFireLogs(tx), fx, fz);
    this.fireLogs.visible = false;
    this.fire = new Campfire(this.scene, new THREE.Vector3(fx, heightAt(fx, fz), fz));
    this.fire.shadowAllowed = this.R.q.shadow >= 2048;
    this.fire.light.shadow.mapSize.setScalar(this.R.q.shadow >= 4096 ? 1024 : 512);
    this.tripod = put(P.buildTripod(), fx, fz);
    this.kettle = P.buildKettle(); this.kettle.position.set(0, 0.81, 0); this.kettle.visible = false; this.tripod.add(this.kettle);
    this.world.colliders.add(fx, fz, 0.85, 'fire');
    // tent
    const tx0 = C.x - 6.5, tz0 = C.z + 3.5;
    this.tent = put(P.buildTent(U), tx0, tz0, 0.9, 0.02);
    this.tentPos = new THREE.Vector3(tx0 + Math.sin(0.9) * 1.8, 0, tz0 + Math.cos(0.9) * 1.8);
    this.world.colliders.add(tx0, tz0, 1.55, 'tent');
    // seats
    const seats = [[fx + 2.4, fz + 0.6, 1.4], [fx - 0.6, fz - 2.5, 0.2]];
    for (const [x, z, r] of seats) { put(P.buildLogSeat(tx), x, z, r); this.world.colliders.add(x, z, 0.5, 'seat'); }
    const chair = put(P.buildChair(), fx + 0.4, fz + 2.6, Math.PI + 0.2);
    this.world.colliders.add(chair.position.x, chair.position.z, 0.35, 'chair');
    // wood pile
    this.woodpile = put(P.buildWoodPile(tx), C.x - 3.5, C.z - 2.2, 0.6);
    // lanterns
    this.lanterns = [];
    const l1 = put(P.buildLantern(), C.x - 4.4, C.z + 5.8); this.lanterns.push(l1);
    // table w/ lantern (simple folding table)
    const table = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.6), new THREE.MeshStandardMaterial({ map: tx.brown_planks_05.diff, normalMap: tx.brown_planks_05.nor, roughness: 0.7 }));
    top.position.y = 0.7; top.castShadow = top.receiveShadow = true; table.add(top);
    for (const [a, b] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7), new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8, roughness: 0.4 })); l.position.set(a, 0.35, b); table.add(l); }
    const l2 = P.buildLantern(); l2.position.y = 0.715; table.add(l2); this.lanterns.push(l2);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.09, 16), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.3 })); mug.position.set(-0.3, 0.76, 0.1); table.add(mug);
    put(table, C.x + 4.2, C.z + 4.2, -0.5);
    this.world.colliders.add(C.x + 4.2, C.z + 4.2, 0.6, 'table');
    // string lights between tent and a pole
    // wooden poles for the string lights
    const poleMat = new THREE.MeshStandardMaterial({ map: tx.bark_brown_02.diff, normalMap: tx.bark_brown_02.nor, roughness: 1 });
    const poleA = [tx0 + 0.9, tz0 - 1.9], poleB = [C.x + 4.9, C.z + 5.6];
    for (const [px, pz] of [poleA, poleB]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.5, 10), poleMat);
      pole.position.set(px, heightAt(px, pz) + 1.25, pz); pole.castShadow = true; this.scene.add(pole);
      this.world.colliders.add(px, pz, 0.12, 'pole');
    }
    this.buildStringLights(new THREE.Vector3(poleA[0], heightAt(...poleA) + 2.4, poleA[1]), new THREE.Vector3(poleB[0], heightAt(...poleB) + 2.4, poleB[1]));

    // dock at end of path
    const [ex, ez] = PATH_PTS[PATH_PTS.length - 1];
    const dockLen = 16;
    const dock = P.buildDock(tx, dockLen);
    dock.position.set(ex, 0.55, ez); dock.rotation.y = 0.12;
    this.scene.add(dock);
    this.dock = dock;
    const dir = new THREE.Vector3(-Math.sin(0.12), 0, -Math.cos(0.12));
    this.dockEnd = new THREE.Vector3(ex, 0.55, ez).addScaledVector(dir, dockLen - 1.2);
    const inv = new THREE.Matrix4();
    dock.updateMatrixWorld(); inv.copy(dock.matrixWorld).invert();
    const v = new THREE.Vector3();
    this.platforms = [{
      height: 0.6,
      contains: (x, z) => { v.set(x, 0.55, z).applyMatrix4(inv); return Math.abs(v.x) < 1.0 && v.z < 0.3 && v.z > -dockLen; },
    }];
    // rowboat moored at dock
    this.boat = this.buildBoat(); this.boat.position.copy(this.dockEnd).add(new THREE.Vector3(2.1, -0.45, 2)); this.boat.rotation.y = 0.2; this.scene.add(this.boat);
  }

  buildBoat() {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ map: this.assets.textures.brown_planks_05.diff, color: 0x6b8fa0, roughness: 0.7, side: THREE.DoubleSide });
    const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.75 * Math.sin(t * Math.PI / 2) + 0.05, -0.35 + t * 0.55)); }
    const hull = new THREE.LatheGeometry(pts, 32, 0, Math.PI);
    hull.rotateZ(Math.PI / 2); hull.rotateY(Math.PI / 2);
    hull.scale(1, 1, 1);
    const p = hull.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setZ(i, z); p.setX(i, p.getX(i) * 3.2); }
    const shell = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2.3);
    shell.scale(0.8, 0.45, 2.2);
    const m = new THREE.Mesh(shell, wood); m.castShadow = true; g.add(m);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.25), wood); seat.position.y = -0.12; g.add(seat);
    g.userData.bobT = 0;
    return g;
  }

  buildStringLights(a, b) {
    const n = 18, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * 0.5; pts.push(p); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.004, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    this.scene.add(wire);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), this.bulbMat, n - 1);
    const m = new THREE.Matrix4();
    for (let i = 1; i < n; i++) { const p = curve.getPoint(i / n); m.makeTranslation(p.x, p.y - 0.04, p.z); bulbs.setMatrixAt(i - 1, m); }
    this.scene.add(bulbs);
    this.stringLight = new THREE.PointLight(0xffc880, 0, 10, 2);
    this.stringLight.position.copy(curve.getPoint(0.5)).add(new THREE.Vector3(0, -0.3, 0));
    this.scene.add(this.stringLight);
  }

  surfaceAt(x, z, w) {
    if (this.platforms?.some((p) => p.contains(x, z))) return 'wood';
    return this.world.surfaceAt(x, z, w);
  }

  setupMenus() {
    $('btnStart').onclick = () => this.start(false);
    $('btnContinue').onclick = () => this.start(true);
    $('btnMenu').onclick = () => { this.audio.click(); $('menu').classList.remove('hidden'); this.paused = true; };
    $('btnResume').onclick = () => { $('menu').classList.add('hidden'); this.paused = false; this.applyOptions(); };
    $('btnSave').onclick = () => { this.saveGame(); this.ui.toast('💾 セーブしました'); };
    $('btnPhoto').onclick = () => this.togglePhoto(true);
    $('photoHint').onclick = () => this.togglePhoto(false);
    const sens = localStorage.getItem('modan-sens'); if (sens) $('optSens').value = sens;
    const vol = localStorage.getItem('modan-vol'); if (vol) $('optVol').value = vol;
    $('optFps').checked = params.has('fps') || localStorage.getItem('modan-fps') === '1';
    this.applyOptions(true);
  }

  applyOptions(first = false) {
    const q = $('optQuality').value;
    localStorage.setItem('modan-quality', q);
    if (!first && q !== this.R.qualityName) {
      this.R.setQuality(q);
      this.sky.setShadowMapSize(this.R.q.shadow);
      this.grass.setDensity(this.R.q.grass / 1.0);
      this.water.rtScale = this.R.q.water;
      this.water.resize(window.innerWidth * this.R.r.getPixelRatio(), window.innerHeight * this.R.r.getPixelRatio());
    }
    this.state.timeScale = parseFloat($('optTime').value);
    this.input.sens = parseFloat($('optSens').value); localStorage.setItem('modan-sens', $('optSens').value);
    this.audio.setVolume(parseFloat($('optVol').value)); localStorage.setItem('modan-vol', $('optVol').value);
    this.showFps = $('optFps').checked; localStorage.setItem('modan-fps', this.showFps ? '1' : '0');
    $('fps').classList.toggle('hidden', !this.showFps);
  }

  async start(cont) {
    this.audio.init();
    this.audio.setVolume(parseFloat($('optVol').value));
    // fullscreen + landscape lock (mobile)
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch { /* not supported */ }
    if (cont) {
      const d = this.state.load();
      if (d?.player) { this.player.pos.set(d.player.x, 0, d.player.z); this.player.yaw = d.player.yaw; }
      if (d?.fire) { this.fire.fuel = d.fire.fuel; this.fire.lit = d.fire.lit; if (d.fire.fuel > 0) this.fireLogs.visible = true; }
      this.ui.lastQuest = -1;
    }
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.started = true;
    this.ui.refresh();
    this.ui.toast(cont ? 'おかえりなさい' : '湖畔の森へようこそ。まずは薪を集めよう');
    this.saveTimer = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.saveGame(); this.audio.ctx?.suspend(); } else this.audio.ctx?.resume(); });
  }

  saveGame() {
    this.state.fire = { fuel: this.fire.fuel, lit: this.fire.lit };
    this.state.save({ player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw } });
  }

  togglePhoto(on) {
    this.photo = on;
    document.body.classList.toggle('photo', on);
    $('photoHint').classList.toggle('hidden', !on);
    this.viewmodel.root.visible = !on;
    // focus on whatever is in the center
    let fd = 8;
    if (on) {
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), this.camera); rc.far = 200;
      const hit = rc.intersectObjects([this.world.terrain, this.tent, this.fireRing], true)[0];
      if (hit) fd = hit.distance;
      const f = document.createElement('div'); f.id = 'flash'; document.body.appendChild(f);
      requestAnimationFrame(() => { f.style.opacity = 0.8; setTimeout(() => { f.style.opacity = 0; setTimeout(() => f.remove(), 500); }, 80); });
      this.audio.tone(2400, 0.05, 0.12, 'square', 0.5, 0, 0); this.audio.burst(3000, 1, 0.2, 0.08);
      // night sky photo quest
      const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
      if (this.sky.info.night > 0.7 && dir.y > 0.25) { this.state.flags.nightPhoto = true; setTimeout(() => this.ui.toast('🌌 満天の星空を撮影した！'), 600); }
      else if (this.sky.info.night > 0.7) setTimeout(() => this.ui.toast('ヒント：空を見上げて撮ろう'), 600);
    }
    this.R.setPhotoMode(on, fd);
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt || 0, a); }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    if (this.snapping) return;
    let dt = (t - this.last) / 1000; this.last = t;
    dt = Math.min(dt, 1 / 20);
    this.frame(dt);
    if (this.showFps) {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 0.5) {
        const i = this.R.r.info;
        $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps\n${(i.render.triangles / 1e6).toFixed(2)}M tri · ${i.render.calls} dc`;
        this.fpsAcc = 0; this.fpsN = 0;
      }
    }
  }

  frame(dt, warm = false) {
    if (this.paused && !warm) { this.R.render(dt); return; }
    const s = this.state;
    // time of day
    if (this.started) {
      const mul = (this.fastForward || 1) * s.timeScale;
      s.hours += (dt * mul) / 60; // 1 real sec = 1 game min at scale 1
      if (s.hours >= 24) { s.hours -= 24; s.day++; s.flags.coffeeToday = false; }
    }
    const sk = this.sky.update(s.hours, dt, this.player.pos);
    const night = sk.night;

    // weather: occasional light rain in the afternoon of day 2+
    const rainTarget = (s.day >= 2 && s.hours > 13 && s.hours < 14.5) ? 1 : 0;
    this.rain = lerp(this.rain || 0, rainTarget, dt * 0.1);
    this.world.terrainU.uWet.value = this.rain;

    // morning mist
    this.fogMorning = Math.max(0, (this.fogMorning || 0) - dt * 0.004);
    const mist = smoothstep(4.5, 6.5, s.hours) * (1 - smoothstep(7.5, 10, s.hours));
    this.scene.fog.density += mist * 0.012 + this.rain * 0.004;

    // player & camera
    if (this.started && !this.photo) this.player.update(dt, this.input);
    else if (!this.started) {
      // cinematic title camera orbiting the camp
      this.titleCam += dt * 0.03;
      const C = WORLD.camp, a = this.titleCam + 2.2;
      this.camera.position.set(C.x + Math.cos(a) * 11, heightAt(C.x, C.z) + 2.6, C.z + Math.sin(a) * 11);
      this.camera.lookAt(C.x - 3, heightAt(C.x, C.z) + 1.0, C.z);
    } else if (this.photo) this.player.update(dt, this.input); // free look while in photo mode
    if (this.shakeAmt > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt * 0.05; this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.05; this.shakeAmt -= dt * 2; }

    // survival stats
    if (this.started) {
      const gm = (dt * s.timeScale * (this.fastForward || 1)) / 60; // game hours
      const pp = this.player.pos;
      const fireD = Math.hypot(pp.x - this.fire.position.x, pp.z - this.fire.position.z);
      const nearFire = this.fire.intensity * smoothstep(7, 1.5, fireD);
      const cold = night * 0.6 + this.rain * 0.4 + (this.player.inWater > 0.1 ? 1 : 0);
      s.warmth = clamp(s.warmth + (nearFire * 0.5 - cold * 0.08 - 0.01) * gm, 0, 1);
      s.hunger = clamp(s.hunger - 0.03 * gm, 0, 1);
      s.energy = clamp(s.energy - (0.025 + (this.input.getMove().run ? 0.04 : 0)) * gm, 0, 1);
      this.player.speedMul = 0.6 + 0.4 * smoothstep(0, 0.25, Math.min(s.energy, s.hunger));
      // berries regrow
      for (const pk of this.world.pickups) if (pk.type === 'berry' && pk.regrow > 0) { pk.regrow -= dt; if (pk.regrow <= 0) pk.berries.visible = true; }
      if (s.advanceQuests((q) => this.ui.questDone(q))) this.ui.refresh();
      this.uiT = (this.uiT || 0) + dt;
      if (this.uiT > 0.5) { this.uiT = 0; this.ui.refresh(); }
      this.saveTimer += dt; if (this.saveTimer > 30) { this.saveTimer = 0; this.saveGame(); }
    }

    // world systems
    this.world.update(dt, this.camera);
    this.grass.update(dt, this.camera.position, this.player.pos, night);
    this.fire.update(dt, this.world.U.uWind.value, this.rain);
    this.fireLogs.userData.charred && (this.fireLogs.userData.charred.emissiveIntensity = this.fire.intensity * 2.5);
    if (this.fire.fuel <= 0.01 && !this.fire.lit) this.fireLogs.visible = false;
    this.fireflies.update(dt, night * (1 - this.rain) * smoothstep(0.3, 0.9, night));
    this.particles.update(dt, this.camera, this.rain);
    this.water.update(dt, this.sky, this.fire);
    this.viewmodel.update(dt, Math.hypot(this.player.vel.x, this.player.vel.z));
    if (this.started) this.interact.update(dt);

    // lanterns & string lights come on at dusk
    const lampOn = smoothstep(0.1, 0.6, night + sk.dusk * 0.4);
    for (const l of this.lanterns) {
      l.userData.light.intensity = lampOn * (2.2 + Math.sin(performance.now() * 0.013) * 0.08);
      l.userData.flame.visible = lampOn > 0.05;
    }
    this.stringLight.intensity = lampOn * 3;
    this.bulbMat.color.setRGB(2.2 * lampOn, 1.45 * lampOn, 0.6 * lampOn);
    this.tent.userData.light.intensity = lampOn * 1.2;
    this.world.U.uTentGlow.value = lampOn * 0.5;
    // boat bob
    if (this.boat) { const bt = performance.now() * 0.001; this.boat.position.y = -0.02 + Math.sin(bt * 1.1) * 0.03; this.boat.rotation.z = Math.sin(bt * 0.9) * 0.03; this.boat.rotation.x = Math.sin(bt * 0.7) * 0.02; }

    // tone/exposure grading by time of day
    this.R.bloom.intensity = 0.9 + night * 0.9;
    this.R.grade.saturation = lerp(0.14, -0.05, night) + sk.dusk * 0.1;
    if (this.R.ao) this.R.ao.configuration.intensity = lerp(2.2, 1.2, night);
    this.R.r.toneMappingExposure = 1;

    // audio
    if (this.audio.enabled) {
      const pp = this.player.pos;
      this.audio.update(dt, {
        night, rain: this.rain, fireLevel: this.fire.intensity,
        fireDist: Math.hypot(pp.x - this.fire.position.x, pp.z - this.fire.position.z),
        waterDist: Math.max(0, lakeDistApprox(pp.x, pp.z)),
      });
    }

    // render
    this.reflT = (this.reflT || 0) + 1;
    if (!params.has('norefl')) this.water.renderReflection([this.grass.layers[0], this.grass.layers[1], this.particles.rain, this.viewmodel.root]);
    if (params.has('nocomposer')) this.R.r.render(this.scene, this.camera); else this.R.render(dt);
  }
}

import { lakeDist } from './world/heightfield.js';
const lakeDistApprox = (x, z) => lakeDist(x, z);

new Game().init().catch((e) => {
  console.error(e);
  $('loadtxt').textContent = 'エラー: ' + e.message;
});
