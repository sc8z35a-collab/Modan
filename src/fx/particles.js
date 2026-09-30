// Wood chips burst, rain streaks + ground mist.
import * as THREE from 'three';
import { heightAt, WORLD } from '../world/heightfield.js';

// small canvas textures for the ambient particles (built once)
function leafTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  // 4 leaf variants in a 2x2 atlas: birch yellow, maple-ish orange, dry brown, green
  const cols = [['#d9b43a', '#a88420'], ['#d8702a', '#9a4516'], ['#8a6a3a', '#5c4424'], ['#7f9a3a', '#56702a']];
  cols.forEach(([a, b], i) => {
    const ox = (i % 2) * 32 + 16, oy = ((i / 2) | 0) * 32 + 16;
    g.save(); g.translate(ox, oy); g.rotate(0.4);
    const grd = g.createLinearGradient(-10, 0, 10, 0); grd.addColorStop(0, b); grd.addColorStop(0.5, a); grd.addColorStop(1, b);
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, -13); g.bezierCurveTo(10, -8, 10, 6, 0, 13); g.bezierCurveTo(-10, 6, -10, -8, 0, -13); g.fill();
    g.strokeStyle = 'rgba(60,40,15,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -12); g.lineTo(0, 15); g.stroke();
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(0, k * 4); g.lineTo(6, k * 4 - 4); g.moveTo(0, k * 4); g.lineTo(-6, k * 4 - 4); g.stroke(); }
    g.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.chipsList = [];
    this.chipGeo = new THREE.BoxGeometry(0.04, 0.01, 0.07);
    this.chipMat = new THREE.MeshStandardMaterial({ color: 0xc09a68, roughness: 0.9 });

    // rain
    const N = 9000;
    const pos = new Float32Array(N * 3), seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 20; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; seeds[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio || 1, 2) } };
    this.rain = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPR; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime*(14.0+aSeed*4.0), 20.0) - 6.0;
          p.xz = mod(p.xz - uCam.xz + 20.0, 40.0) - 20.0; p += vec3(uCam.x, uCam.y, uCam.z);
          vec4 mv = viewMatrix*vec4(p,1.0); vA = step(aSeed, 1.0);
          gl_PointSize = clamp(3.0 * (6.0 / max(-mv.z, 0.05)) * uPR, 0.0, 64.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uAmt; void main(){ vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.08,0.0,abs(c.x)) * (1.0-abs(c.y)*2.0) * uAmt * 0.45; gl_FragColor = vec4(vec3(0.75,0.8,0.9)*a, a); }`,
    }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);

    // ---- rain splashes: crowns that pop on the ground / lake around the player (positions relocated on respawn)
    const SN = 260;
    this.splashN = SN;
    this.splashPos = new Float32Array(SN * 3); this.splashAge = new Float32Array(SN).fill(1);
    this.splashRate = new Float32Array(SN); for (let i = 0; i < SN; i++) this.splashRate[i] = 2.2 + Math.random() * 2.5;
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(this.splashPos, 3));
    sgeo.setAttribute('aAge', new THREE.BufferAttribute(this.splashAge, 1));
    this.splashU = { uAmt: { value: 0 }, uPR: this.rainU.uPR };
    this.splash = new THREE.Points(sgeo, new THREE.ShaderMaterial({
      uniforms: this.splashU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aAge; uniform float uPR; varying float vAge;
        void main(){ vAge = aAge; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp((4.0 + aAge * 10.0) * (6.0 / max(-mv.z, 0.05)) * uPR, 0.0, 48.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAmt; varying float vAge;
        void main(){ vec2 c = gl_PointCoord - 0.5; c.y *= 1.6; float d = length(c);
          float ring = smoothstep(0.08, 0.0, abs(d - vAge * 0.42)) * (1.0 - vAge);
          float a = ring * uAmt * 0.6; if (a < 0.003) discard; gl_FragColor = vec4(vec3(0.8, 0.85, 0.9) * a, a); }`,
    }));
    this.splash.frustumCulled = false; this.splash.visible = false;
    scene.add(this.splash);

    // ---- falling leaves: slow tumbling cards drifting down in the forest (the canopy thins out over the lake)
    const LN = 70;
    this.leafN = LN;
    this.leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.07), new THREE.MeshStandardMaterial({
      map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8,
    }), LN);
    // pick one atlas cell per leaf via per-instance uv offset
    const uvOff = new Float32Array(LN * 2);
    for (let i = 0; i < LN; i++) { const k = (Math.random() * 4) | 0; uvOff[i * 2] = (k % 2) * 0.5; uvOff[i * 2 + 1] = ((k / 2) | 0) * 0.5; }
    this.leaves.geometry.setAttribute('aUvOff', new THREE.InstancedBufferAttribute(uvOff, 2));
    this.leaves.material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aUvOff;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uv * 0.5 + aUvOff;\n#endif');
    };
    this.leaves.castShadow = false; this.leaves.frustumCulled = false;
    this.leafState = Array.from({ length: LN }, () => ({ p: new THREE.Vector3(0, -999, 0), ph: Math.random() * 6.28, spin: 1 + Math.random() * 2, fall: 0.35 + Math.random() * 0.35, ground: 1e9, rest: 0.01 + Math.random() * 4 }));
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    scene.add(this.leaves);

    // ---- dust / pollen motes floating in the air, sparkling when backlit by the sun (god-ray feel)
    const DN = 500;
    const dpos = new Float32Array(DN * 3), dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) { dpos[i * 3] = (Math.random() - 0.5) * 16; dpos[i * 3 + 1] = Math.random() * 6; dpos[i * 3 + 2] = (Math.random() - 0.5) * 16; dseed[i] = Math.random(); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 1));
    this.dustU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uAmt: { value: 0 }, uPR: this.rainU.uPR, uCol: { value: new THREE.Color(1, 0.95, 0.8) } };
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      uniforms: this.dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed; uniform float uTime, uPR; uniform vec3 uCam, uSun; varying float vA;
        void main(){ vec3 p = position;
          float t = uTime * (0.05 + aSeed * 0.08);
          p += vec3(sin(t * 3.1 + aSeed * 40.0), sin(t * 2.3 + aSeed * 17.0) * 0.6, cos(t * 2.7 + aSeed * 23.0)) * 0.8;
          p.xz = mod(p.xz - uCam.xz + 8.0, 16.0) - 8.0; p.y = mod(p.y - uCam.y + 2.0, 6.0) - 2.0;
          p += uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vec3 V = normalize(p - uCam);
          float fwd = pow(max(dot(V, normalize(uSun)), 0.0), 6.0);     // forward scattering towards the sun
          float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 90.0);
          vA = (0.12 + fwd * 1.6) * tw * smoothstep(9.0, 1.0, -mv.z) * smoothstep(0.2, 0.8, -mv.z);
          gl_PointSize = clamp((1.2 + aSeed) * (6.0 / max(-mv.z, 0.05)) * uPR, 0.0, 16.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uAmt; uniform vec3 uCol; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA * uAmt; if (a < 0.002) discard; gl_FragColor = vec4(uCol * a, a); }`,
    }));
    this.dust.frustumCulled = false; this.dust.visible = false;
    scene.add(this.dust);
  }

  // env (optional): { night, sunDir: Vector3, wind: Vector2 } — without it the ambient layers assume a calm day
  updateAmbient(dt, cam, rain, env = {}) {
    const night = env.night ?? 0, wind = env.wind;
    const cp = cam.position;
    // splashes
    const splashAmt = rain;
    this.splash.visible = splashAmt > 0.02;
    if (this.splash.visible) {
      const P = this.splashPos, A = this.splashAge;
      for (let i = 0; i < this.splashN; i++) {
        A[i] += dt * this.splashRate[i];
        if (A[i] >= 1) {
          A[i] = Math.random() * 0.2;
          const a = Math.random() * Math.PI * 2, r = 0.6 + Math.sqrt(Math.random()) * 11;
          const x = cp.x + Math.cos(a) * r, z = cp.z + Math.sin(a) * r;
          P[i * 3] = x; P[i * 3 + 1] = Math.max(heightAt(x, z), WORLD.waterLevel) + 0.03; P[i * 3 + 2] = z;
        }
      }
      this.splash.geometry.attributes.position.needsUpdate = true;
      this.splash.geometry.attributes.aAge.needsUpdate = true;
      this.splashU.uAmt.value = splashAmt;
    }
    // leaves: a few in the air at any time around the player (fewer at night / in heavy rain they fall faster)
    const leafAmt = (1 - night * 0.7);
    const m = this._m4, q = this._q, e = this._e;
    const wx = wind ? wind.x : 0.6, wz = wind ? wind.y : 0.3;
    for (let i = 0; i < this.leafN; i++) {
      const L = this.leafState[i];
      const far = Math.abs(L.p.x - cp.x) > 14 || Math.abs(L.p.z - cp.z) > 14;
      if (far || (L.rest > 0 && (L.rest -= dt) <= 0)) {
        if (Math.random() > leafAmt * 0.5 && !far) { L.rest = 2 + Math.random() * 6; continue; }
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 12;
        L.p.set(cp.x + Math.cos(a) * r, 0, cp.z + Math.sin(a) * r);
        L.ground = heightAt(L.p.x, L.p.z);
        L.p.y = L.ground + 4 + Math.random() * 6;
        L.rest = 0;
      }
      if (L.p.y > L.ground + 0.01) {
        L.ph += dt * L.spin;
        const flutter = Math.sin(L.ph * 1.7);
        L.p.x += (Math.cos(L.ph) * 0.35 + wx * 0.5) * dt;
        L.p.z += (Math.sin(L.ph * 0.8) * 0.35 + wz * 0.5) * dt;
        L.p.y -= (L.fall * (0.7 + 0.5 * Math.abs(flutter)) + rain * 1.5) * dt;
        const over = L.p.y < WORLD.waterLevel + 0.005 && L.ground < WORLD.waterLevel;
        if (L.p.y <= L.ground + 0.01 || over) { L.p.y = Math.max(L.ground, WORLD.waterLevel) + 0.01; L.rest = 8 + Math.random() * 10; }
        e.set(L.ph * 0.9 + flutter, L.ph * 0.6, Math.cos(L.ph) * 1.2);
      } else e.set(-Math.PI / 2, L.ph, 0); // lying flat on the ground / floating on the lake
      q.setFromEuler(e);
      m.compose(L.p, q, this._s);
      this.leaves.setMatrixAt(i, m);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    // dust
    this.dustU.uTime.value += dt;
    this.dustU.uCam.value.copy(cp);
    if (env.sunDir) this.dustU.uSun.value.copy(env.sunDir);
    this.dustU.uAmt.value = (1 - night) * (1 - rain) * (env.sunDir ? Math.max(0.15, Math.min(1, env.sunDir.y * 3)) : 0.6);
    this.dust.visible = this.dustU.uAmt.value > 0.01;
  }

  setPixelRatio(pr) { this.rainU.uPR.value = pr; } // shared by splash / dust uniforms

  chips(pos) {
    for (let i = 0; i < 10; i++) {
      if (this.chipsList.length >= 120) break; // cap: rapid chopping spawned unbounded meshes
      const m = new THREE.Mesh(this.chipGeo, this.chipMat);
      m.position.set(pos.x, pos.y + 0.5, pos.z);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      m.userData.life = 1.5; m.castShadow = true;
      this.scene.add(m); this.chipsList.push(m);
    }
  }

  update(dt, cam, rain, env) {
    this.updateAmbient(dt, cam, rain, env || this.env); // this.env is filled by src/fx/laned.js
    for (let i = this.chipsList.length - 1; i >= 0; i--) {
      const m = this.chipsList[i], u = m.userData;
      u.life -= dt; u.v.y -= 9.8 * dt;
      m.position.addScaledVector(u.v, dt);
      // land on the ground instead of falling through the terrain
      if (u.ground === undefined) u.ground = heightAt(m.position.x, m.position.z) + 0.01;
      if (m.position.y <= u.ground) { m.position.y = u.ground; u.v.set(0, 0, 0); }
      else { m.rotation.x += dt * 10; m.rotation.z += dt * 7; }
      if (u.life <= 0) { this.scene.remove(m); this.chipsList.splice(i, 1); }
    }
    this.rainU.uTime.value += dt; this.rainU.uCam.value.copy(cam.position); this.rainU.uAmt.value = rain;
    this.rain.visible = rain > 0.01;
  }
}
