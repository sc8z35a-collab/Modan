import * as THREE from 'three';
import { Renderer, QUALITY } from './core/renderer.js';
import { Input } from './core/input.js';
import { Sky } from './world/sky.js';
import { World, loadAssets } from './world/world.js';
import { Water } from './world/water.js';
import { Grass } from './world/grass.js';
import { WORLD, heightAt, lakeDist } from './world/heightfield.js';
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
import { LensUI } from './ui/lensui.js';
import { buildCampDetails } from './world/campdetail.js';
import { installLaneD } from './fx/laned.js';
import { clamp, lerp, smoothstep } from './core/noise.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// localStorage can throw (private mode, storage disabled, quota) -> never let that kill the game
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const USER_QUALITIES = ['ultra', 'high', 'medium'];

class Game {
  async init() {
    const setLoad = (p, txt) => { if (params.has('snap')) console.log('[load]', p.toFixed(2), txt || '', performance.memory ? (performance.memory.usedJSHeapSize/1e6).toFixed(0)+'MB' : ''); $('loadbar').style.width = Math.round(p * 100) + '%'; if (txt) $('loadtxt').textContent = txt; };
    // URL param wins (QA harness passes ?q=qa; previously a saved menu choice silently overrode it),
    // unknown names (old saves, typos) fall back to ultra instead of crashing on QUALITY[undefined]
    let savedQ = params.get('q') || store.get('modan-quality') || 'ultra';
    if (!QUALITY[savedQ]) savedQ = 'ultra';
    // non-menu profiles (qa) get a temporary option, otherwise the select showed "ultra" and closing the
    // menu silently switched the renderer to ultra
    if (!USER_QUALITIES.includes(savedQ)) { const o = document.createElement('option'); o.value = o.textContent = savedQ; $('optQuality').appendChild(o); }
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
    // fireflies spawned over the lake sat on the lake bed (under water) -> clamp to the surface
    this.fireflies.setGround((x, z) => Math.max(heightAt(x, z), WORLD.waterLevel));

    this.input = new Input();
    this.player = new Player(this.camera, this.world.colliders, this.audio, (x, z, w) => this.surfaceAt(x, z, w), this.platforms);
    this.viewmodel = new ViewModel(this.camera, this.assets.textures);
    this.ui = new UI(this);
    this.lensUI = new LensUI(this);
    const lens = this.R.lens;
    const zoomOk = () => this.started && !this.paused && !this.interact?.busy;
    this.input.onZoom = (k) => { if (zoomOk()) lens.zoomBy(k); };
    this.input.onZoomStep = (d) => { if (zoomOk()) lens.step(d); };
    if (params.has('zoom')) lens.setZoom(+params.get('zoom'), true);
    this.interact = new Interactions(this);
    this.laneD = installLaneD(this); // Lane D: field guide, ambience, weather-aware water/particles, moon phase
    this.input.onAction = () => {
      // ignore actions on the title screen, while the menu is open or in photo mode
      if (!this.started || this.paused || this.photo) return;
      this.audio.click(); this.interact.act();
    };
    this.input.onTap = () => { if (this.photo && performance.now() - this.photoT > 250) this.togglePhoto(false); };
    // body.photo hides the whole HUD (incl. the look zone), so the only exit was the tiny hint that has
    // pointer-events:none -> photo mode could not be left on touch devices. Exit on any tap.
    // (the look zone now stays active in photo mode: drag looks around, a short tap exits via onTap. The old
    // window-wide pointerup exit also fired at the end of every look drag.)

    this.R.buildComposer();
    const resizeFx = () => {
      const pr = this.R.r.getPixelRatio();
      this.water.resize(window.innerWidth * pr, window.innerHeight * pr);
      this.fire.setPixelRatio?.(pr); this.fireflies.setPixelRatio?.(pr); this.particles.setPixelRatio?.(pr);
    };
    this.resizeFx = resizeFx;
    resizeFx();
    window.addEventListener('resize', resizeFx);
    window.visualViewport?.addEventListener('resize', resizeFx);

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
      if (sh.pos) { const [x, z, yaw, pitch] = sh.pos; this.player.teleport(x, z, yaw); this.player.pitch = pitch || 0; }
      if (sh.extra.includes('fire')) { this.fire.addFuel(1); this.fire.ignite(); this.fire.intensity = 1; this.fireLogs.visible = true; }
      if (sh.extra.includes('rain')) this.rain = 1;
      const zm = /z([0-9.]+)/.exec(sh.extra); this.R.lens.setZoom(zm ? +zm[1] : 1, true);
      this.state.timeScale = 0; this.sky.envTimer = 99; this.snapping = true; this.snapPlayer = !sh.extra.includes('title');
      const nf = +(params.get('snapf') || 2); for (let k = 0; k < nf; k++) { this.frame(1 / 30); console.log('[snap] frame', k, performance.now() | 0); await new Promise((r) => setTimeout(r, 0)); }
      const cp = this.camera.position; console.log('[snap] cam', cp.x.toFixed(1), cp.y.toFixed(1), cp.z.toFixed(1), this.snapPlayer);
      const png = this.R.r.domElement.toDataURL('image/jpeg', 0.85);
      const i = this.R.r.info;
      await fetch('/__snap', { method: 'POST', body: JSON.stringify({ name: sh.name, png, info: { fps: $('fps').textContent, tris: i.render.triangles, calls: i.render.calls, trees: this.world.treeCount, ua: navigator.userAgent, gpu: this.gpuName() } }) }).catch(() => {});
    }
    document.title = 'SNAP DONE'; this.snapping = false;
    // external QA (PlaywrightConsoleCapture wait_for_selector="#snapdone") waits for this instead of a fixed timer
    const d = document.createElement('i'); d.id = 'snapdone'; d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px'; document.body.appendChild(d);
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
    this.fire.setShadowSize(this.R.q.shadow >= 4096 ? 1024 : 512);
    this.tripod = put(P.buildTripod(), fx, fz);
    this.kettle = P.buildKettle(); this.kettle.position.set(0, 0.81, 0); this.kettle.visible = false; this.tripod.add(this.kettle);
    this.world.colliders.add(fx, fz, 0.85, 'fire');
    // tent
    const tx0 = C.x - 6.5, tz0 = C.z + 3.5;
    this.tent = put(P.buildTent(U), tx0, tz0, 0.9, 0.02);
    P.settleToGround(this.tent, heightAt); // Lane B: pegs / guy lines followed flat ground (up to 9cm floating)
    this.tentPos = new THREE.Vector3(tx0 + Math.sin(0.9) * 1.8, 0, tz0 + Math.cos(0.9) * 1.8);
    this.world.colliders.add(tx0, tz0, 1.55, 'tent');
    // seats
    const seats = [[fx + 2.4, fz + 0.6, 1.4], [fx - 0.6, fz - 2.5, 0.2]];
    // 2.2m logs had a single 0.5m collider at the centre -> walk through both ends; chain circles along the log
    for (const [x, z, r] of seats) { put(P.buildLogSeat(tx), x, z, r); for (const o of [-0.8, 0, 0.8]) this.world.colliders.add(x + Math.cos(r) * o, z - Math.sin(r) * o, 0.3, 'seat'); }
    // the backrest is at local +z, so the sitter faces local -z: rotation PI+0.2 faced exactly AWAY from the fire
    const chair = put(P.buildChair(), fx + 0.4, fz + 2.6, Math.atan2(0.4, 2.6));
    this.world.colliders.add(chair.position.x, chair.position.z, 0.35, 'chair');
    // wood pile
    this.woodpile = put(P.buildWoodPile(tx), C.x - 3.5, C.z - 2.2, 0.6);
    this.world.colliders.add(C.x - 3.5, C.z - 2.2, 0.45, 'woodpile'); // player walked through the stack
    // lanterns
    this.lanterns = [];
    const l1 = put(P.buildLantern(), C.x - 4.4, C.z + 5.8); this.lanterns.push(l1);
    // folding table w/ lantern (Lane B: slatted top, rails, cord; the mug moved to campdetail)
    const table = put(P.buildTable(tx), C.x + 4.2, C.z + 4.2, -0.5);
    if (table.userData.lantern) this.lanterns.push(table.userData.lantern);
    this.table = table;
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
    // start the deck where the terrain drops to deck height (the first ~5m used to be buried in the hillside,
    // and the player could not walk onto the dock because the step up from the terrain was blocked)
    const [px0, pz0] = PATH_PTS[PATH_PTS.length - 1];
    const ddx = -Math.sin(0.12), ddz = -Math.cos(0.12);
    let ds = 0; while (ds < 12 && heightAt(px0 + ddx * ds, pz0 + ddz * ds) > 0.62) ds += 0.1;
    const ex = px0 + ddx * ds, ez = pz0 + ddz * ds;
    const dockLen = 16;
    const dock = P.buildDock(tx, dockLen);
    dock.position.set(ex, 0.55, ez); dock.rotation.y = 0.12;
    this.scene.add(dock);
    this.dock = dock;
    const dir = new THREE.Vector3(ddx, 0, ddz);
    this.dockEnd = new THREE.Vector3(ex, 0.55, ez).addScaledVector(dir, dockLen - 1.2);
    const inv = new THREE.Matrix4();
    dock.updateMatrixWorld(); inv.copy(dock.matrixWorld).invert();
    const v = new THREE.Vector3();
    this.platforms = [{
      height: 0.6,
      contains: (x, z) => { v.set(x, 0.55, z).applyMatrix4(inv); return Math.abs(v.x) < 1.0 && v.z < 0.3 && v.z > -dockLen; },
    }];
    // rowboat moored at dock
    this.boat = P.buildRowboat(tx); this.boatCap = this.boat.userData.cap; // Lane B: clinker-built rowboat this.boat.position.copy(this.dockEnd).add(new THREE.Vector3(2.1, 0, 2)); this.boat.rotation.y = 0.2; this.scene.add(this.boat);
    // hull is 0.45m deep with its rim at local y=0: at +0.02 the rim sat 4cm above the lake (boat looked sunk)
    this.boatBaseY = WORLD.waterLevel + 0.26;
    // Lane B: ~40 small camp props (chopping block, cooler, stove, sleeping bag, washing line, tackle...)
    this.campDetails = buildCampDetails({ scene: this.scene, textures: tx, U, heightAt, colliders: this.world.colliders, camp: C,
      firePos: new THREE.Vector3(fx, heightAt(fx, fz), fz), tent: this.tent, tentOrigin: { x: tx0, z: tz0 }, tentRot: 0.9, poleA, dock: this.dock,
      dockEnd: this.dockEnd, boat: this.boat, table });
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
    $('btnMenu').onclick = () => { if (this.photo) return; this.audio.click(); $('menu').classList.remove('hidden'); this.paused = true; this.input.reset(); };
    $('btnResume').onclick = () => { $('menu').classList.add('hidden'); this.paused = false; this.input.reset(); this.applyOptions(); };
    $('btnSave').onclick = () => { const ok = this.saveGame(); this.ui.toast(ok ? '💾 セーブしました' : '⚠ セーブできませんでした'); };
    $('btnPhoto').onclick = () => this.togglePhoto(true);
    const sens = store.get('modan-sens'); if (sens && Number.isFinite(+sens)) $('optSens').value = sens;
    const vol = store.get('modan-vol'); if (vol && Number.isFinite(+vol)) $('optVol').value = vol;
    // the time-speed option was never persisted
    const tsc = store.get('modan-time'); if (tsc && [...$('optTime').options].some((o) => o.value === tsc)) $('optTime').value = tsc;
    $('optFps').checked = params.has('fps') || store.get('modan-fps') === '1';
    this.applyOptions(true);
  }

  applyOptions(first = false) {
    const q = $('optQuality').value;
    // only persist real user choices; with ?q=qa the select showed "ultra" and applyOptions(true) wrote
    // "ultra" to storage, so the next normal visit silently switched quality
    if (!first && q !== this.R.qualityName && QUALITY[q]) {
      if (USER_QUALITIES.includes(q)) store.set('modan-quality', q);
      this.R.setQuality(q);
      this.sky.setShadowMapSize(this.R.q.shadow);
      this.grass.setDensity(this.R.q.grass);
      this.water.rtScale = this.R.q.water;
      this.fire.shadowAllowed = this.R.q.shadow >= 2048;
      this.fire.setShadowSize(this.R.q.shadow >= 4096 ? 1024 : 512);
      this.resizeFx();
      // tree count and grass buffers are sized at load: raising quality silently kept the old density
      if (this.R.q.grass > this.grass.baseDensity + 1e-6 || this.R.q.trees !== this.world.q.trees) this.ui.toast('草木の密度は再読み込み後に反映されます');
    }
    const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
    this.state.timeScale = num($('optTime').value, 1); if (!first) store.set('modan-time', $('optTime').value);
    this.input.sens = num($('optSens').value, 1.2); store.set('modan-sens', $('optSens').value);
    this.audio.setVolume(num($('optVol').value, 0.8)); store.set('modan-vol', $('optVol').value);
    this.showFps = $('optFps').checked; if (!(first && params.has('fps'))) store.set('modan-fps', this.showFps ? '1' : '0'); // ?fps (QA) stuck forever
    $('fps').classList.toggle('hidden', !this.showFps);
  }

  async start(cont) {
    // double-tapping start/continue ran this twice (save loaded over a running game, listeners stacked)
    if (this.starting || this.started) return;
    this.starting = true;
    this.audio.init();
    this.audio.setVolume(parseFloat($('optVol').value));
    // fullscreen + landscape lock (mobile); lock() may never settle on some browsers -> don't hang the start
    await Promise.race([this.enterFullscreen(), new Promise((r) => setTimeout(r, 1500))]);
    // re-enter fullscreen on the next touch if the user swiped it away (Android back gesture / notification shade)
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.started) window.addEventListener('touchend', () => this.enterFullscreen(), { once: true });
    });
    this.requestWakeLock();
    if (cont) {
      const d = this.state.load();
      const pl = d?.player;
      if (pl && Number.isFinite(pl.x) && Number.isFinite(pl.z)) this.player.teleport(pl.x, pl.z, pl.yaw);
      const fs = this.state.fire; // validated by state.load()
      this.fire.fuel = fs.fuel; this.fire.lit = fs.lit && fs.fuel > 0;
      if (this.fire.fuel > 0) this.fireLogs.visible = true;
      this.ui.lastQuest = -1;
    } else this.player.teleport(this.player.pos.x, this.player.pos.z);
    this.input.reset();
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.started = true;
    this.ui.refresh();
    this.ui.toast(cont ? 'おかえりなさい' : '湖畔の森へようこそ。まずは薪を集めよう');
    this.saveTimer = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.saveGame(); this.audio.ctx?.suspend(); this.input.reset(); }
      else { this.audio.ctx?.resume(); this.requestWakeLock(); }
    });
    window.addEventListener('pagehide', () => this.saveGame());
    this.starting = false;
  }

  async enterFullscreen() {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      await screen.orientation?.lock?.('landscape');
    } catch { /* not supported / not allowed without gesture */ }
  }

  // keep the screen awake while camping (the phone would otherwise dim during idle fire-watching)
  async requestWakeLock() {
    if (document.hidden || (this.wakeLock && !this.wakeLock.released)) return;
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* denied */ }
  }

  saveGame() {
    if (!this.started) return false; // never overwrite a real save with the untouched title-screen state
    this.state.fire = { fuel: this.fire.fuel, lit: this.fire.lit };
    return this.state.save({ player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw } });
  }

  togglePhoto(on) {
    if (!!this.photo === on) return;
    if (on && (!this.started || this.paused || this.interact.mode || this.interact.busy)) return; // not during minigames / sleep
    this.photo = on; this.photoT = performance.now();
    this.input.reset();
    document.body.classList.toggle('photo', on);
    $('photoHint').classList.toggle('hidden', !on);
    this.viewmodel.root.visible = !on;
    // focus on whatever is in the center
    let fd = 8;
    if (on) {
      // terrain/water: march the analytic heightfield (a brute-force raycast against the ~400k-triangle terrain
      // stalled the frame for tens of ms, and water was ignored); props: normal raycast on small meshes
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), this.camera); rc.far = 200;
      const o = rc.ray.origin, d = rc.ray.direction;
      for (let t = 0.5; t < 200; t += Math.max(0.25, t * 0.02)) {
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        if (y <= Math.max(heightAt(x, z), WORLD.waterLevel)) { fd = t; break; }
      }
      const hit = rc.intersectObjects([this.tent, this.fireRing, this.dock, this.boat, this.table, this.campDetails?.group].filter(Boolean), true)[0];
      if (hit && hit.distance < fd) fd = hit.distance;
      const f = document.createElement('div'); f.id = 'flash'; document.body.appendChild(f);
      requestAnimationFrame(() => { f.style.opacity = 0.8; setTimeout(() => { f.style.opacity = 0; setTimeout(() => f.remove(), 500); }, 80); });
      this.audio.tone(2400, 0.05, 0.12, 'square', 0.5, 0, 0); this.audio.burst(3000, 1, 0.2, 0.08);
      // night sky photo quest
      const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
      if (this.sky.info.night > 0.7 && dir.y > 0.25 && (this.rain || 0) < 0.3) { this.state.flags.nightPhoto = true; setTimeout(() => this.ui.toast('🌌 満天の星空を撮影した！'), 600); }
      else if (this.sky.info.night > 0.7 && dir.y > 0.25) setTimeout(() => this.ui.toast('雲で星が見えない…雨が止むのを待とう'), 600);
      else if (this.sky.info.night > 0.7) setTimeout(() => this.ui.toast('ヒント：空を見上げて撮ろう'), 600);
    }
    this.R.setPhotoMode(on, fd);
  }

  shake(a) { this.shakeAmt = Math.max(this.shakeAmt || 0, a); }

  // sun-shadow centre: the player at <=2x; pushed out along the view ray when zoomed so the telephoto subject
  // (up to ~150m away) sits inside the 110m shadow frustum instead of being unshadowed
  shadowFocus() {
    const z = this.R.lens.zoom, p = this.player.pos;
    const out = this._sf || (this._sf = new THREE.Vector3()), f = this._sfd || (this._sfd = new THREE.Vector3());
    out.copy(p);
    if (z <= 2 || !this.started) return out;
    this.camera.getWorldDirection(f); f.y = 0;
    const l = f.length(); if (l < 1e-4) return out;
    const d = Math.min(150, 28 * Math.log2(z)); // 2x: 28m .. 20x: ~121m
    out.x += (f.x / l) * d; out.z += (f.z / l) * d; out.y = heightAt(out.x, out.z);
    return out;
  }

  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    if (this.snapping) return;
    // rAF timestamps can be older than performance.now() taken in init -> negative dt ran time backwards
    let dt = (t - this.last) / 1000; this.last = t;
    if (!(dt > 0)) dt = 0;
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
    this.R.r.info.reset(); // once per frame, so the reflection pass is included in the stats
    if (this.paused && !warm) { this.R.render(dt); return; }
    const s = this.state;
    // time of day
    if (this.started) {
      const mul = (this.fastForward || 1) * s.timeScale;
      s.hours += (dt * mul) / 60; // 1 real sec = 1 game min at scale 1
      if (s.hours >= 24) { s.hours -= 24; s.day++; s.flags.coffeeToday = false; }
    }
    const sk = this.sky.update(s.hours, dt, this.shadowFocus());
    const night = sk.night;

    // weather: occasional light rain in the afternoon of day 2+
    const rainTarget = (s.day >= 2 && s.hours > 13 && s.hours < 14.5) ? 1 : 0;
    this.rain = lerp(this.rain || 0, rainTarget, dt * 0.1);
    this.world.terrainU.uWet.value = this.rain;

    // morning mist
    this.fogMorning = Math.max(0, (this.fogMorning || 0) - dt * 0.004);
    const mist = smoothstep(4.5, 6.5, s.hours) * (1 - smoothstep(7.5, 10, s.hours));
    // fogMorning (set after sleeping) was decayed every frame but never actually applied
    this.scene.fog.density += mist * 0.012 + this.rain * 0.004 + this.fogMorning * 0.006;
    this.sky.uniforms.uCloud.value = 0.35 + this.rain * 0.55; // overcast while raining

    // lens: smooth zoom -> camera FOV, slower look + stabilisation at tele, LOD bias
    const lens = this.R.lens;
    if (this.started && !this.paused) this.input.keyZoom(dt);
    this.R.updateLens(dt);
    this.input.lookScale = lens.lookScale();
    this.player.stab = lens.stabilise();
    this.viewmodel.setLensScale?.(lens.viewmodelScale());
    this.lensUI?.update(dt);

    // player & camera
    if ((this.started || this.snapPlayer) && !this.photo) this.player.update(dt, this.input);
    else if (!this.started) {
      if (lens.target !== 1) lens.setZoom(1, true);
      // cinematic title camera orbiting the camp
      this.titleCam += dt * 0.03;
      const C = WORLD.camp, a = this.titleCam + 2.2;
      this.camera.position.set(C.x + Math.cos(a) * 11, heightAt(C.x, C.z) + 2.6, C.z + Math.sin(a) * 11);
      this.camera.lookAt(C.x - 3, heightAt(C.x, C.z) + 1.0, C.z);
    } else if (this.photo) this.player.update(dt, this.input, true); // free look (no walking) in photo mode
    if (this.shakeAmt > 0) { const sa = this.shakeAmt * 0.05 * lens.stabilise(); this.camera.position.x += (Math.random() - 0.5) * sa; this.camera.position.y += (Math.random() - 0.5) * sa; this.shakeAmt -= dt * 2; }

    // survival stats
    if (this.started) {
      const gm = (dt * s.timeScale * (this.fastForward || 1)) / 60; // game hours
      const pp = this.player.pos;
      const fireD = Math.hypot(pp.x - this.fire.position.x, pp.z - this.fire.position.z);
      const nearFire = this.fire.intensity * smoothstep(7, 1.5, fireD);
      const cold = night * 0.6 + this.rain * 0.4 + (this.player.inWater > 0.1 ? 1 : 0);
      s.warmth = clamp(s.warmth + (nearFire * 0.5 - cold * 0.08 - 0.01) * gm, 0, 1);
      s.hunger = clamp(s.hunger - 0.03 * gm, 0, 1);
      // the run toggle alone (standing still) used to drain energy
      const running = Math.hypot(this.player.vel.x, this.player.vel.z) > 3.2;
      s.energy = clamp(s.energy - (0.025 + (running ? 0.04 : 0)) * gm, 0, 1);
      this.player.speedMul = 0.6 + 0.4 * smoothstep(0, 0.25, Math.min(s.energy, s.hunger));
      // berries regrow
      for (const pk of this.world.pickups) if (pk.type === 'berry' && pk.regrow > 0) { pk.regrow -= dt; if (pk.regrow <= 0) { pk.regrow = 0; pk.berries.visible = true; } }
      if (s.advanceQuests((q) => this.ui.questDone(q))) this.ui.refresh();
      this.uiT = (this.uiT || 0) + dt;
      if (this.uiT > 0.5) { this.uiT = 0; this.ui.refresh(); }
      this.saveTimer += dt; if (this.saveTimer > 30) { this.saveTimer = 0; this.saveGame(); }
    }

    // world systems
    this.world.update(dt, this.camera, lens.lodBias());
    this.grass.update(dt, this.camera.position, this.player.pos, night, this.world.U.uWind.value, lens.zoom);
    this.fire.update(dt, this.world.U.uWind.value, this.rain);
    this.fireLogs.userData.charred && (this.fireLogs.userData.charred.emissiveIntensity = this.fire.intensity * 2.5);
    if (this.fire.fuel <= 0.01 && !this.fire.lit) this.fireLogs.visible = false;
    this.fireflies.update(dt, night * (1 - this.rain) * smoothstep(0.3, 0.9, night));
    this.particles.update(dt, this.camera, this.rain);
    this.laneD?.update(dt);
    this.water.update(dt, this.sky, this.fire);
    this.viewmodel.update(dt, Math.hypot(this.player.vel.x, this.player.vel.z));
    if (this.started) this.interact.update(dt);

    // lanterns & string lights come on at dusk
    const lampOn = smoothstep(0.1, 0.6, night + sk.dusk * 0.4);
    const flick = 2.2 + Math.sin(performance.now() * 0.013) * 0.08;
    for (const l of this.lanterns) {
      l.userData.light.intensity = lampOn * flick;
      l.userData.flame.visible = lampOn > 0.05;
    }
    this.stringLight.intensity = lampOn * 3;
    this.bulbMat.color.setRGB(2.2 * lampOn, 1.45 * lampOn, 0.6 * lampOn);
    this.tent.userData.light.intensity = lampOn * 1.2;
    this.world.U.uTentGlow.value = lampOn * 0.5;
    // boat bob
    if (this.boat) { const bt = performance.now() * 0.001; this.boat.position.y = this.boatBaseY + Math.sin(bt * 1.1) * 0.03; this.boat.rotation.z = Math.sin(bt * 0.9) * 0.03; this.boat.rotation.x = Math.sin(bt * 0.7) * 0.02; }

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
        waterDist: Math.max(0, lakeDist(pp.x, pp.z)),
      });
    }

    // render
    if (!params.has('norefl')) this.water.renderReflection([this.grass.layers[0], this.grass.layers[1], this.particles.rain, this.viewmodel.root, this.boatCap]);
    if (params.has('nocomposer')) this.R.r.render(this.scene, this.camera); else this.R.render(dt);
  }
}

new Game().init().catch((e) => {
  console.error(e);
  $('loading').classList.remove('hidden');
  $('loadtxt').textContent = 'エラー: ' + (e?.message || e) + ' — ページを再読み込みしてください';
});
